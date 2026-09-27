// P5.1 G18_parser_benchmark — 60 frozen golden cases (20/domain: 10
// straightforward + 5 wording + 3 irrelevant + 2 unsupported-but-parsable).
//
// MODES:
//   live   — MATHVIZ_LLM_BASE_URL/API_KEY/MODEL all set: a real model parses
//            every statement end-to-end (A0 routing -> A1 spec -> validation
//            -> compile -> repair-once). Tokens are spent.
//   replay — no LLM env: GoldenProvider answers from the frozen dataset.
//            This exercises the ENTIRE deterministic pipeline (routing
//            plumbing, schema/semantic/compile gates, normalization,
//            metrics) with zero tokens. Replay percentages are plumbing
//            checks, NOT model-quality claims, and are reported as such.
//
// Metrics (P5.1 §27) with first engineering thresholds (§28):
//   final schema+semantic valid >= 98%
//   semantic match (normalized) >= 95%
//   goal capability accuracy    >= 95%
//   engine-supported compile    >= 90% (on expected-COMPILE_OK cases)
//   answer leakage              == 0
//   unsupported cases: engine refusal correctly surfaced (no silent parse
//   failure, no invented capability)

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { parseProblemSpec } from "../../parser/src/parse";
import { OpenAICompatibleProvider, GoldenProvider } from "../../parser/src/provider";
import { leakScan } from "../../parser/src/telemetry";
import { semanticEqual } from "./normalize-spec";

const OUT_DIR = path.join(ROOT, "runs", "p51");

interface BenchCase { id: string; domain: string; category: string; statement: string; golden: any; expected: "COMPILE_OK" | "ENGINE_UNSUPPORTED" }

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("G18 assertion failed: " + msg);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "parser-bench", "cases.json"), "utf8"));
  const cases: BenchCase[] = dataset.cases;
  assert(cases.length === 60, `expected 60 cases, got ${cases.length}`);
  for (const d of ["geometry2d", "motion1d", "function2d"]) {
    assert(cases.filter((c) => c.domain === d).length === 20, `${d} must have 20 cases`);
  }

  const live = OpenAICompatibleProvider.fromEnv();
  const mode = live ? "live" : "replay";
  // Replay uses ONE single-case GoldenProvider per case: the provider cannot
  // infer which case it is serving from the prompt text (the prompt embeds
  // few-shot statements that would otherwise collide with dataset
  // statements), so ambiguity is impossible by construction.
  const providerFor = (c: BenchCase) =>
    live ?? new GoldenProvider([{ statement: c.statement, domain: c.domain, golden: c.golden }]);
  console.log(`G18 mode: ${mode}${live ? ` (${live.id})` : " (GoldenProvider — pipeline check, not a model-quality claim)"}`);

  const rows: any[] = [];
  const m = {
    domainOk: 0,
    schemaValid: 0,
    semanticMatch: 0,          // over PARSER_ACCEPTED with expected COMPILE_OK
    goalCapOk: 0,              // goal capability sets equal (over valid specs)
    supportedCompileOk: 0,     // expected COMPILE_OK && PARSER_ACCEPTED
    supportedTotal: 0,
    unsupportedRefused: 0,     // expected ENGINE_UNSUPPORTED && got it
    unsupportedTotal: 0,
    repairUsed: 0,
    leaks: 0
  };

  for (const c of cases) {
    const out = await parseProblemSpec(providerFor(c) as any, c.statement, { noCache: true });
    if (out.repairUsed) m.repairUsed++;

    const domainOk = out.domain === c.domain;
    if (domainOk) m.domainOk++;

    const valid = out.status === "PARSER_ACCEPTED" || out.status === "ENGINE_UNSUPPORTED";
    if (valid) m.schemaValid++;

    if (valid && out.spec) {
      const wantCaps = [...c.golden.goals].map((g: any) => g.capabilityId).sort().join(",");
      const gotCaps = [...(out.spec.goals ?? [])].map((g: any) => g.capabilityId).sort().join(",");
      if (wantCaps === gotCaps) m.goalCapOk++;
      if (leakScan(out.spec).length > 0) m.leaks++;
    }

    let semantic = null as boolean | null;
    if (out.status === "PARSER_ACCEPTED" && c.expected === "COMPILE_OK") {
      semantic = semanticEqual(out.spec, c.golden);
      if (semantic) m.semanticMatch++;
    }

    if (c.expected === "COMPILE_OK") {
      m.supportedTotal++;
      if (out.status === "PARSER_ACCEPTED") m.supportedCompileOk++;
    } else {
      m.unsupportedTotal++;
      if (out.status === "ENGINE_UNSUPPORTED") m.unsupportedRefused++;
    }

    rows.push({
      id: c.id, domain: c.domain, category: c.category, expected: c.expected,
      status: out.status, routedDomain: out.domain, domainOk,
      valid, semantic, repairUsed: out.repairUsed,
      errors: out.errors.slice(0, 3).map((e) => `${e.category}:${e.code}`)
    });
    const flag = (valid && (semantic === null || semantic) && domainOk) ? "ok " : "DIFF";
    console.log(`${flag} ${c.id} [${c.category}] -> ${out.status}${out.repairUsed ? " (repaired)" : ""}`);
  }

  const pct = (n: number, d: number) => (d === 0 ? 1 : n / d);
  const summary = {
    gate: "G18_parser_benchmark",
    mode,
    provider: live ? live.id : "golden-replay",
    cases: cases.length,
    metrics: {
      domain_accuracy: pct(m.domainOk, cases.length),
      final_schema_semantic_valid: pct(m.schemaValid, cases.length),
      semantic_match: pct(m.semanticMatch, m.supportedTotal),
      goal_capability_accuracy: pct(m.goalCapOk, m.schemaValid),
      supported_compile_success: pct(m.supportedCompileOk, m.supportedTotal),
      unsupported_refused_correctly: pct(m.unsupportedRefused, m.unsupportedTotal),
      repair_rate: pct(m.repairUsed, cases.length),
      answer_leaks: m.leaks
    },
    thresholds: {
      final_schema_semantic_valid: 0.98,
      semantic_match: 0.95,
      goal_capability_accuracy: 0.95,
      supported_compile_success: 0.90,
      answer_leaks: 0
    }
  };

  const checks = [
    ["final_schema_semantic_valid", summary.metrics.final_schema_semantic_valid >= 0.98],
    ["semantic_match", summary.metrics.semantic_match >= 0.95],
    ["goal_capability_accuracy", summary.metrics.goal_capability_accuracy >= 0.95],
    ["supported_compile_success", summary.metrics.supported_compile_success >= 0.90],
    ["unsupported_refused_correctly", summary.metrics.unsupported_refused_correctly === 1],
    ["answer_leakage_zero", summary.metrics.answer_leaks === 0]
  ] as const;

  fs.writeFileSync(path.join(OUT_DIR, "benchmark.json"), JSON.stringify({ ...summary, rows }, null, 2) + "\n", "utf8");

  console.log("\nmetrics:");
  for (const [k, v] of Object.entries(summary.metrics)) {
    console.log(`  ${k}: ${typeof v === "number" ? v.toFixed(4) : v}`);
  }
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? "ok  " : "FAIL"} threshold ${name}`);
    if (!pass) ok = false;
  }
  console.log(`G18_parser_benchmark: ${ok ? "PASS" : "FAIL"} (mode=${mode})`);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
