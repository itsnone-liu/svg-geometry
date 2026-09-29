// P5.4 Stage-4 — v5 pre-freeze preflight: offline gates B1–B12 (owner list).
// Deterministic; zero provider requests. All twelve must PASS before the
// benchmark freeze commit is created.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ROOT } from "../../contracts/src/load";
import { validatorFor } from "../../contracts/src/load";
import { validateProblemSpec } from "../../contracts/src/spec-validate";
import { attemptCompileV5 } from "../../parser/src/parse-v5";
import { specCallV5 } from "../../parser/src/prompt-v5";

const DIR = path.join(ROOT, "fixtures", "parser-bench-v5");
const RUNS = path.join(ROOT, "runs", "p53");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function run(cmd: string, args: string[], cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function main() {
  const dataset = JSON.parse(fs.readFileSync(path.join(DIR, "cases.json"), "utf8"));
  const registry = JSON.parse(fs.readFileSync(path.join(DIR, "challenge-registry.json"), "utf8"));
  const results: Array<[string, boolean, string]> = [];
  const add = (name: string, pass: boolean, detail = "") => results.push([name, pass, detail]);

  // B1 — 72/72 schema-valid benchmark definitions.
  let invalid: string[] = [];
  for (const c of dataset.cases) {
    const v = validatorFor("problemspec");
    if (!v(c.golden) || validateProblemSpec(c.golden).length) invalid.push(c.id);
  }
  add("B1_SCHEMA_VALID_72", invalid.length === 0, invalid.length ? `invalid: ${invalid.join(",")}` : "72/72");

  // B2 — exact 66/6/0 class matrix.
  const co = dataset.cases.filter((c: any) => c.expected_class === "COMPILE_OK").length;
  const eu = dataset.cases.filter((c: any) => c.expected_class === "ENGINE_UNSUPPORTED").length;
  const kl = dataset.cases.filter((c: any) => c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT").length;
  add("B2_CLASS_MATRIX_66_6_0", co === 66 && eu === 6 && kl === 0, `CO=${co} EU=${eu} KL=${kl}`);

  // B3 — domain matrix 24/24/24.
  const doms = ["geometry2d", "motion1d", "function2d"].map((d) => dataset.cases.filter((c: any) => c.domain === d).length);
  add("B3_DOMAIN_24_24_24", doms.every((n) => n === 24), doms.join("/"));

  // B4 — every expected capability statically resolvable.
  let capBad: string[] = [];
  for (const c of dataset.cases) {
    const caps = c.expectations.expectedCapabilities as string[];
    if (!caps.length) { capBad.push(`${c.id}:no-capability`); continue; }
    const att = attemptCompileV5(c.golden, c.statement);
    if (c.expected_class === "COMPILE_OK") { if (!att.ok) capBad.push(`${c.id}:not-ok`); }
    else if (!(att.engineUnsupported && att.compileError?.code === c.expected_error && att.errors.length === 1)) capBad.push(`${c.id}:not-EU-clean`);
  }
  add("B4_CAPABILITIES_RESOLVABLE", capBad.length === 0, capBad.join(",") || "72/72 statically resolved");

  // B5 — every grounding expectation has exact source span authority.
  let spanBad: string[] = [];
  for (const c of dataset.cases) {
    for (const g of c.expectations.groundingAuthority) {
      if (!(typeof g.start === "number" && typeof g.end === "number" && g.start >= 0 && g.end > g.start && g.end <= c.statement.length && c.statement.slice(g.start, g.end) === g.text)) spanBad.push(`${c.id}:${g.path}`);
    }
  }
  add("B5_SPAN_AUTHORITY_EXACT", spanBad.length === 0, spanBad.join(",") || "all spans exact");

  // B6 — dual/challenge registry complete.
  const dualIds = new Set(registry.dual_registry.cases.map((x: any) => x.case_id));
  const computedDual = new Set(dataset.cases.filter((c: any) => c.domain === "function2d" && c.golden.entities?.some((e: any) => e.kind === "function")).map((c: any) => c.id));
  const counts = registry.dual_registry.counts;
  add("B6_DUAL_REGISTRY_COMPLETE",
    dualIds.size === 15 && counts.total === 15 && counts.A_DUAL_COMPILE_OK === 13 && counts.B_DUAL_ENGINE_UNSUPPORTED === 2
    && [...dualIds].every((id) => computedDual.has(id)) && [...computedDual].every((id) => dualIds.has(id))
    && registry.dual_registry.cases.every((x: any) => typeof x.expected === "string" && x.expected.length > 10),
    `registry=${dualIds.size} computed=${computedDual.size} split=${counts.A_DUAL_COMPILE_OK}/${counts.B_DUAL_ENGINE_UNSUPPORTED}`);

  // B7 — repair-sensitive coverage complete (all nine owner classes).
  const missing = registry.repair_sensitive_coverage.classes.filter((x: any) => !x.cases.length || x.cases.some((id: string) => !dataset.cases.some((c: any) => c.id === id)));
  add("B7_REPAIR_SENSITIVE_COVERAGE", missing.length === 0, missing.length ? `missing: ${missing.map((m: any) => m.class).join(",")}` : `${registry.repair_sensitive_coverage.classes.length}/9 classes covered`);

  // B8 — scorer determinism: two runs byte-identical.
  const g1 = run(process.execPath, [TSX, "packages/parser-benchmark/src/run-v5-golden.ts"]);
  const rep1 = fs.readFileSync(path.join(RUNS, "v5-golden-report.json"));
  const g2 = run(process.execPath, [TSX, "packages/parser-benchmark/src/run-v5-golden.ts"]);
  const rep2 = fs.readFileSync(path.join(RUNS, "v5-golden-report.json"));
  const b8 = g1.code === 0 && g2.code === 0 && g1.out.includes("PASS") && rep1.equals(rep2);
  add("B8_SCORER_DETERMINISM", b8, rep1.equals(rep2) ? "byte-identical" : "reports differ");

  // B9 — v3 frozen evidence replay PASS.
  const v3 = run(process.execPath, [TSX, "packages/parser-benchmark/src/run-v3.ts", "--replay"]);
  add("B9_V3_FROZEN_REPLAY", v3.code === 0 && v3.out.includes("PASS"), v3.out.trim().split("\n").pop() ?? "");

  // B10 — v4 golden scorer PASS.
  const v4 = run(process.execPath, [TSX, "packages/parser-benchmark/src/run-v4-golden.ts"]);
  add("B10_V4_GOLDEN_SCORER", v4.code === 0 && v4.out.includes("PASS"), v4.code === 0 ? "PASS" : "FAIL");

  // B11 — Stage-3 H1–H5 PASS.
  const vt = run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/p54-stage31.test.ts", "--reporter=dot"], ROOT);
  add("B11_STAGE3_H1_H5", vt.code === 0, vt.code === 0 ? "8/8" : vt.out.trim().split("\n").pop() ?? "");

  // B12 — no answer/expected-output leakage into the provider-visible packet.
  // (The spec-call input legitimately wraps the statement in fixed prompt
  // scaffolding; the statement itself must appear verbatim and nothing
  // golden/expectation-related may ride along.)
  let leakBad: string[] = [];
  for (const c of dataset.cases) {
    const req = specCallV5(c.statement, c.domain);
    const packet = JSON.stringify(req);
    if (!req.input.includes(c.statement)) leakBad.push(`${c.id}:statement-absent`);
    for (const token of ["COMPILE_OK", "ENGINE_UNSUPPORTED", "KNOWN_LIMITATION", "expected_class", "expected_error", "expectations"]) if (packet.includes(token)) leakBad.push(`${c.id}:${token}`);
    const ids = (c.golden.entities ?? []).map((e: any) => e.id).filter((id: string) => id.length >= 4);
    for (const id of ids) if (packet.includes(id)) leakBad.push(`${c.id}:entity-id-${id}`);
  }
  add("B12_PACKET_NO_LEAKS", leakBad.length === 0, leakBad.slice(0, 5).join(",") || "72 packets clean (statement-only input; no goldens/expectations)");

  // Report.
  const pass = results.every(([, p]) => p);
  const report = { gate: "P5_4_STAGE4_PREFLIGHT_B1_B12", pass, checks: results.map(([n, p, d]) => ({ name: n, pass: p, detail: d })), packet_hash_note: "canonical packet hash computed in freeze-v5" };
  fs.mkdirSync(RUNS, { recursive: true });
  fs.writeFileSync(path.join(RUNS, "v5-preflight-report.json"), JSON.stringify(report, null, 1) + "\n", "utf8");
  for (const [name, p, d] of results) console.log(`${p ? "PASS" : "FAIL"} ${name}${d ? ` — ${d}` : ""}`);
  console.log(`P5_4_STAGE4_PREFLIGHT: ${pass ? "PASS (12/12)" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main();
