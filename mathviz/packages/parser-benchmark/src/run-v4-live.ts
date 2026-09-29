// P5.3 v4 single live acceptance runner (git-blob authority).
// Executes THE one authorized live batch: single pass over the 72 frozen cases
// in dataset order, no retry, no per-case rerun. Dataset + freeze authority
// come from raw git blobs at the pinned freeze commit. The first provider
// generate() call writes the consumption marker (live authorization = CONSUMED
// at that instant); afterwards this run's verdict stands regardless of outcome.
// Scoring replicates the frozen run-v4-golden checks exactly (verified against
// golden replay before the live launch); repair semantic regression uses the
// real v3 semantics (A1 core match lost through repair).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "../../contracts/src/load";
import { OpenAICompatibleProvider, GoldenProvider } from "../../parser/src/provider";
import { parseProblemSpecV4 } from "../../parser/src/parse-v4";
import { semanticEqual } from "./normalize-spec";
import { groundProblemSpec } from "./grounding";
import { checkSourceFidelity } from "../../parser/src/fidelity";
import { checkFunctionZeroDuality } from "../../parser/src/function-zero-duality";
import { leakScan } from "../../parser/src/telemetry";
import { verifyFreezeV4, V4_DATASET_PATH } from "./freeze-v4";
import { readGitBlob } from "./git-blob";

type Expected = "COMPILE_OK" | "ENGINE_UNSUPPORTED" | "KNOWN_LIMITATION_EXPECTED_REJECT";
const OUT_DIR = path.join(ROOT, "runs", "p53");
const CONSUMED_MARKER = path.join(OUT_DIR, "v4-live-consumed.json");
const PARSER_OWNED = new Set(["E_SOURCE_COMPLETENESS", "E_SOURCE_EXPRESSION_LOSS", "E_SOURCE_IRRELEVANT", "E_FUNCTION_ZERO_FUNCTION_MISSING", "E_FUNCTION_ZERO_EQUATION_MISSING", "E_FUNCTION_ZERO_GOAL_BINDING", "E_PROVENANCE", "E_PROVENANCE_GROUNDING", "E_BINDING"]);

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const freezeCommitIdx = process.argv.indexOf("--freeze-commit");
  const freezeRev = freezeCommitIdx >= 0 ? process.argv[freezeCommitIdx + 1] : undefined;
  const requireLive = process.argv.includes("--require-live");
  const forceReplay = process.argv.includes("--replay");

  const freeze = verifyFreezeV4({ rev: freezeRev });
  const dataset = JSON.parse(readGitBlob(freezeRev ?? "HEAD", V4_DATASET_PATH).toString("utf8"));
  const cases: any[] = dataset.cases;
  assert.equal(cases.length, 72, "v4 requires 72 cases");
  assert.equal(dataset.version, 4);
  for (const d of ["geometry2d", "motion1d", "function2d"]) assert.equal(cases.filter((c) => c.domain === d).length, 24, `${d} must have 24 cases`);
  const dual = (c: any) => c.domain === "function2d" && !!c.golden?.entities?.some((e: any) => e.kind === "function");
  assert.equal(cases.filter(dual).length, 15);
  assert.equal(cases.filter((c) => dual(c) && c.expected_class === "COMPILE_OK").length, 11);
  assert.equal(cases.filter((c) => dual(c) && c.expected_class === "ENGINE_UNSUPPORTED").length, 2);
  assert.equal(cases.filter((c) => dual(c) && c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT").length, 2);
  assert.equal(cases.filter((c) => c.domain === "function2d" && !c.golden?.entities?.some((e: any) => e.kind === "function")).length, 9);

  const live = forceReplay ? null : OpenAICompatibleProvider.fromEnv();
  if (requireLive && !live) throw new Error("--require-live but secure credentials are unavailable; refusing replay as live evidence");
  const mode = live ? "live" : "replay";
  const replay = new GoldenProvider(cases);
  let consumedWritten = false;
  const writeConsumed = () => {
    if (consumedWritten) return;
    consumedWritten = true;
    fs.writeFileSync(CONSUMED_MARKER, JSON.stringify({
      consumed_at_utc: new Date().toISOString(),
      event: "first benchmark A1/model request dispatched to provider",
      freeze_commit: freeze.generated_from_commit,
      verified_freeze_commit: freeze.verified_commit,
      mode, model: live ? live.id : null, pid: process.pid,
      note: "single live authorization is CONSUMED from this instant; the verdict of this run stands; no second batch may replace it",
    }, null, 2) + "\n", "utf8");
    console.error(`[run-v4-live] LIVE AUTHORIZATION CONSUMED at ${new Date().toISOString()} (marker: runs/p53/v4-live-consumed.json)`);
  };
  const provider = live
    ? new Proxy(live, { get(target: any, prop: string, receiver: any) { if (prop === "generate") writeConsumed(); return Reflect.get(target, prop, receiver); } })
    : replay;

  const rows: any[] = [];
  const diagnosticsAll: any[] = [];
  let coreOk = 0, compileOk = 0, goalOk = 0, unsupportedOk = 0, knownOk = 0, valid = 0, leaks = 0, silent = 0, regressions = 0, gGround = 0, gTotal = 0, dualDetected = 0, bareOver = 0, maxRepairs = 0;
  let dualCompileOk = 0, dualUnsupportedCorrect = 0, dualKnownCorrect = 0, dualCompileOkDen = 0, dualUnsupportedDen = 0, dualKnownDen = 0;
  const tokens = { prompt: 0, completion: 0, total: 0 };

  for (const c of cases) {
    if (mode === "replay") replay.select(c.statement);
    const row: any = { case_id: c.id, expected_class: c.expected_class };
    let out: any = null;
    try {
      out = await parseProblemSpecV4(provider, c.statement, { domain: c.domain });
    } catch (e: any) {
      row.actual_class = "RUNNER_ERROR";
      row.error = String(e?.message ?? e);
      rows.push(row);
      diagnosticsAll.push({ case_id: c.id, statement: c.statement, runner_error: row.error });
      continue; // no retry; the miss stands
    }
    const candidate = (() => { const repair = out.diagnostics?.find((d: any) => d.stage === "repair")?.parsed_candidate; return repair ?? out.diagnostics?.find((d: any) => d.stage === "A1")?.parsed_candidate ?? null; })();
    const a1Candidate = out.diagnostics?.find((d: any) => d.stage === "A1")?.parsed_candidate ?? null;
    const repairUsed = !!out.diagnostics?.find((d: any) => d.stage === "repair");
    const errors = out.errors?.map((e: any) => e.code) ?? [];
    const core = !!candidate && semanticEqual(candidate, c.golden);
    const a1Core = !!a1Candidate && semanticEqual(a1Candidate, c.golden);
    const goal = !!candidate && candidate.goals?.every((g: any) => g.capabilityId === c.golden.goals?.[0]?.capabilityId);
    const expected = c.expected_class as Expected;
    const outcome = out.status === "PARSER_ACCEPTED" ? "COMPILE_OK" : out.status === "ENGINE_UNSUPPORTED" ? "ENGINE_UNSUPPORTED" : "KNOWN_LIMITATION_EXPECTED_REJECT";
    const knownClean = expected === "KNOWN_LIMITATION_EXPECTED_REJECT" && out.status === "PARSE_FAILED" && errors.length === 1 && errors[0] === c.expected_error;
    const actualFamily = knownClean && errors[0] === "E_PROVENANCE_GROUNDING" ? "function_zero_bad_provenance" : null;

    if (expected === "COMPILE_OK") { if (core) coreOk++; if (out.status === "PARSER_ACCEPTED") compileOk++; }
    if (expected !== "KNOWN_LIMITATION_EXPECTED_REJECT" && goal) goalOk++;
    if (expected === "ENGINE_UNSUPPORTED" && out.status === "ENGINE_UNSUPPORTED" && errors.includes(c.expected_error)) unsupportedOk++;
    if (knownClean) knownOk++;
    if (outcome === expected) valid++;
    if (candidate) {
      const g = groundProblemSpec(candidate, c.statement);
      gGround += g.semanticGroundedCount; gTotal += g.semanticTotal;
      leaks += leakScan(candidate).length;
      const f = (() => { try { return checkSourceFidelity(candidate, c.statement); } catch { return { findings: [{ code: "E_FIDELITY_INTERNAL" }] }; } })();
      if (expected === "COMPILE_OK" && !core && f.findings.length === 0) silent++;
    }
    const reps = (out.diagnostics ?? []).filter((d: any) => d.stage === "repair").length;
    maxRepairs = Math.max(maxRepairs, reps);
    if (repairUsed && a1Core && !core) regressions++;
    for (const d of out.diagnostics ?? []) { if (d.usage) { tokens.prompt += d.usage.prompt_tokens ?? 0; tokens.completion += d.usage.completion_tokens ?? 0; tokens.total += d.usage.total_tokens ?? 0; } }

    const isDual = !!c.golden?.entities?.some((e: any) => e.kind === "function");
    if (isDual) {
      const d = candidate ? checkFunctionZeroDuality(candidate, c.statement) : null;
      if (core || !!d?.findings.length || knownClean) dualDetected++;
      if (expected === "COMPILE_OK") { dualCompileOkDen++; if (out.status === "PARSER_ACCEPTED" && core) dualCompileOk++; }
      if (expected === "ENGINE_UNSUPPORTED") { dualUnsupportedDen++; if (out.status === "ENGINE_UNSUPPORTED" && core && out.compileError?.code === c.expected_error && !errors.some((e: string) => PARSER_OWNED.has(e))) dualUnsupportedCorrect++; }
      if (expected === "KNOWN_LIMITATION_EXPECTED_REJECT") { dualKnownDen++; if (knownClean && c.expected_stage === "G19" && actualFamily === c.expected_failure_family) dualKnownCorrect++; }
    } else if (candidate && checkFunctionZeroDuality(candidate, c.statement).applicable) bareOver++;

    row.actual_class = outcome; row.final_candidate_used = !!candidate; row.repair_calls = reps; row.core_match = core; row.goal_capability_match = goal;
    row.dual_group = !isDual ? null : expected === "COMPILE_OK" ? "A_DUAL_COMPILE_OK" : expected === "ENGINE_UNSUPPORTED" ? "B_DUAL_ENGINE_UNSUPPORTED" : "C_DUAL_KNOWN_LIMITATION";
    row.errors = errors;
    rows.push(row);
    diagnosticsAll.push({ case_id: c.id, statement: c.statement, status: out.status, errors: out.errors, compile_error: out.compileError ?? null, usage: out.usage ?? null, diagnostics: out.diagnostics ?? [] });
    console.error(`[run-v4-live] ${c.id} -> ${outcome} core=${core} repairs=${reps}`);
  }

  const rate = (n: number, d: number) => (d ? n / d : 1);
  const checks: Array<[string, boolean]> = [
    ["CASE_COUNT", cases.length === 72 && cases.every((c) => cases.filter((x) => x.domain === c.domain).length === 24)],
    ["CLASS_DISTRIBUTION", cases.filter((c) => c.expected_class === "COMPILE_OK").length === 64 && cases.filter((c) => c.expected_class === "ENGINE_UNSUPPORTED").length === 6 && cases.filter((c) => c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT").length === 2],
    ["EXPECTED_ACTUAL_MATRIX", valid === 72],
    ["FINAL_SCHEMA_SEMANTIC_VALIDITY", rate(valid, 72) >= 0.98],
    ["CORE_SEMANTIC_MATCH", coreOk / 64 >= 0.95],
    ["SUPPORTED_COMPILE_SUCCESS", compileOk / 64 >= 0.90],
    ["GOAL_CAPABILITY_ACCURACY", goalOk / 70 >= 0.95],
    ["DUAL_DETECTED_OR_CORRECT", dualDetected === 15],
    ["DUAL_SPLIT_DENOMINATORS", dualCompileOkDen === 11 && dualUnsupportedDen === 2 && dualKnownDen === 2 && dualCompileOkDen + dualUnsupportedDen + dualKnownDen === 15],
    ["DUAL_COMPILE_OK_ACCEPTED_CORE", dualCompileOk === 11],
    ["DUAL_ENGINE_UNSUPPORTED_CORRECT", dualUnsupportedCorrect === 2],
    ["DUAL_KNOWN_LIMITATION_CORRECT", dualKnownCorrect === 2],
    ["BARE_EQUATION_CONTROL", bareOver === 0],
    ["ENGINE_UNSUPPORTED", unsupportedOk === 6],
    ["KNOWN_LIMITATION", knownOk === 2],
    ["G19_FINAL_GROUNDING", rate(gGround, gTotal) >= 0.985],
    ["ANSWER_LEAKS", leaks === 0],
    ["SILENT_FIDELITY_ERRORS", silent === 0],
    ["REPAIR_SEMANTIC_REGRESSIONS", regressions === 0],
    ["REPAIR_BUDGET", maxRepairs <= 1],
  ];
  const summary = {
    gate: "G20_P5_3_benchmark_v4_live", mode, provider: live ? live.id : "golden-replay",
    freeze_commit: freeze.generated_from_commit, freeze_verified_commit: freeze.verified_commit,
    model: live ? process.env.MATHVIZ_LLM_MODEL ?? null : null,
    finished_at_utc: new Date().toISOString(),
    tokens,
    denominators: { total: 72, compile_ok: 64, engine_unsupported: 6, known_limitation: 2, goal_capability_eligible: 70, dual_all: 15, dual_compile_ok: 11, dual_engine_unsupported: 2, dual_known_limitation: 2, bare_equation_controls: 9 },
    metrics: {
      final_schema_semantic_valid: { ok: valid, total: 72, rate: valid / 72 },
      core_semantic_match: { matched: coreOk, total: 64, rate: coreOk / 64 },
      supported_compile_success: { ok: compileOk, total: 64, rate: compileOk / 64 },
      goal_capability_accuracy: { ok: goalOk, total: 70, rate: goalOk / 70 },
      dual_detected_or_correct: { ok: dualDetected, total: 15 },
      dual_compile_ok_accepted_core: { ok: dualCompileOk, total: dualCompileOkDen, rate: rate(dualCompileOk, dualCompileOkDen) },
      dual_engine_unsupported_correct: { ok: dualUnsupportedCorrect, total: dualUnsupportedDen },
      dual_known_limitation_correct: { ok: dualKnownCorrect, total: dualKnownDen },
      bare_equation_overconstraint: bareOver,
      unsupported_refused_correctly: unsupportedOk,
      known_limitation_rejected: knownOk,
      g19_final_grounding: { grounded: gGround, total: gTotal, rate: rate(gGround, gTotal) },
      answer_leaks: leaks, silent_fidelity_errors: silent, repair_semantic_regressions: regressions, max_repair_calls: maxRepairs,
    },
    checks: checks.map(([name, pass]) => ({ name, pass })),
    result: checks.every(([, pass]) => pass) ? "PASS" : "FAIL",
  };
  fs.writeFileSync(path.join(OUT_DIR, "benchmark-v4.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "benchmark-v4-rows.json"), JSON.stringify(rows, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "benchmark-v4-diagnostics.json"), JSON.stringify(diagnosticsAll, null, 2) + "\n", "utf8");
  for (const c of checks) console.log(`${c[1] ? "PASS" : "FAIL"} ${c[0]}`);
  console.log(`${summary.gate}: ${summary.result} (${mode})`);
  if (requireLive && summary.result !== "PASS") process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
