import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "../../contracts/src/load";
import { OpenAICompatibleProvider, GoldenProvider } from "../../parser/src/provider";
import { parseProblemSpec } from "../../parser/src/parse";
import { semanticEqual } from "./normalize-spec";
import { groundProblemSpec } from "./grounding";
import { checkSourceFidelity } from "../../parser/src/fidelity";
import { verifyFreezeV3 } from "./freeze-v3";
import { readGitBlob, FROZEN_PATHS } from "./git-blob";
import { leakScan } from "../../parser/src/telemetry";

type Expected = "COMPILE_OK" | "ENGINE_UNSUPPORTED" | "KNOWN_LIMITATION_EXPECTED_REJECT";
type BenchCase = { id: string; domain: string; expected: Expected; statement: string; golden: any; category: string; challengeType?: string };
const OUT_DIR = path.join(ROOT, "runs", "p53");
const CHALLENGES = ["declared-entity-completeness", "irrelevant-grounded-distractor", "expression-term-loss", "multi-finding-one-repair"];

function ratios(ok: number, total: number) { return { ok, total, rate: total ? ok / total : null }; }
function fidelityRates(spec: any, statement: string) {
  let r: ReturnType<typeof checkSourceFidelity>;
  try { r = checkSourceFidelity(spec, statement); } catch { return null; }
  const n = (code: string) => r.findings.filter((f) => f.code === code).length;
  const declared = r.declaredEntities;
  const declFail = n("E_SOURCE_COMPLETENESS");
  const expr = r.sourceExpressions;
  const exprFail = n("E_SOURCE_EXPRESSION_LOSS");
  const graphItems = (spec.entities?.length ?? 0) + (spec.source_facts?.length ?? 0) + (spec.parameters?.length ?? 0) + (spec.constraints?.length ?? 0);
  const irrFail = n("E_SOURCE_IRRELEVANT");
  return {
    declared: ratios(Math.max(0, declared - declFail), declared),
    expression: ratios(Math.max(0, expr - exprFail), expr),
    relevance: ratios(Math.max(0, graphItems - irrFail), graphItems),
    findings: r.findings,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const freezeCommitIdx = process.argv.indexOf("--freeze-commit");
  const freezeRev = freezeCommitIdx >= 0 ? process.argv[freezeCommitIdx + 1] : undefined;
  const requireLive = process.argv.includes("--require-live") || process.env.MATHVIZ_REQUIRE_LIVE === "1";
  // Freeze authority and the benchmark dataset BOTH come from the same frozen
  // git blobs — the runner never parses a smudged worktree representation.
  const freeze = verifyFreezeV3({ rev: freezeRev, requireClean: requireLive });
  const dataset = JSON.parse(readGitBlob(freezeRev ?? "HEAD", FROZEN_PATHS.dataset).toString("utf8"));
  const cases: BenchCase[] = dataset.cases;
  assert(cases.length === 72, "v3 requires 72 cases");
  for (const d of ["geometry2d", "motion1d", "function2d"]) assert(cases.filter((c) => c.domain === d).length === 24, `${d} must have 24 cases`);
  for (const kind of CHALLENGES) assert(cases.filter((c) => c.challengeType === kind).length === 6, `${kind} must have 6 challenges`);

  const forceReplay = process.argv.includes("--replay");
  const live = forceReplay ? null : OpenAICompatibleProvider.fromEnv();
  if (requireLive && !live) throw new Error("MATHVIZ_REQUIRE_LIVE=1 but secure credentials are unavailable; refusing replay as live evidence");
  const mode = live ? "live" : "replay";
  const replay = new GoldenProvider(cases);
  const metrics: any = {
    domainCorrect: 0, validOutcomes: 0, coreMatches: 0, coreTotal: 0,
    goalCapCorrect: 0, goalCapTotal: 0, compileSuccess: 0, supportedTotal: 0,
    unsupportedCorrect: 0, unsupportedTotal: 0, knownLimitCorrect: 0, knownLimitTotal: 0,
    repairCount: 0, maxRepairCalls: 0, repairRegressions: 0, leaks: 0, unsupportedSemanticCorruption: 0,
    g19Grounded: 0, g19Total: 0,
    firstDeclaredOk: 0, firstDeclaredTotal: 0, finalDeclaredOk: 0, finalDeclaredTotal: 0,
    firstExprOk: 0, firstExprTotal: 0, finalExprOk: 0, finalExprTotal: 0,
    firstRelevantOk: 0, firstRelevantTotal: 0, finalRelevantOk: 0, finalRelevantTotal: 0,
    fidelityRepairAttempts: 0, fidelityRepairSuccess: 0, silentFidelityErrors: 0,
    accepted: 0, engineUnsupported: 0, rejected: 0,
  };
  const challengeStats: Record<string, { total: number; detectedOrCorrect: number; silentAcceptedWrong: number; repairs: number; noSecondRepair: number; regressions: number; acceptedCoreMatches: number }> = {};
  for (const k of CHALLENGES) challengeStats[k] = { total: 0, detectedOrCorrect: 0, silentAcceptedWrong: 0, repairs: 0, noSecondRepair: 0, regressions: 0, acceptedCoreMatches: 0 };
  const rows: any[] = [], diagnostics: any[] = [];
  const tokenTotals = { input_tokens: 0, output_tokens: 0 };

  for (const c of cases) {
    if (!live) replay.select(c.statement);
    const out: any = await parseProblemSpec(live ?? replay, c.statement, { domain: c.domain, noCache: true });
    for (const d of out.diagnostics ?? []) {
      tokenTotals.input_tokens += d.usage?.input_tokens ?? 0;
      tokenTotals.output_tokens += d.usage?.output_tokens ?? 0;
    }
    const a1 = (out.diagnostics ?? []).find((d: any) => d.stage === "A1")?.parsed_candidate ?? null;
    const repairCandidates = (out.diagnostics ?? []).filter((d: any) => d.stage === "repair");
    const finalCandidate = repairCandidates.length ? repairCandidates[repairCandidates.length - 1].parsed_candidate : a1;
    const initialFidelity = a1 && typeof a1 === "object" ? fidelityRates(a1, c.statement) : null;
    if (initialFidelity) {
      metrics.firstDeclaredOk += initialFidelity.declared.ok; metrics.firstDeclaredTotal += initialFidelity.declared.total;
      metrics.firstExprOk += initialFidelity.expression.ok; metrics.firstExprTotal += initialFidelity.expression.total;
      metrics.firstRelevantOk += initialFidelity.relevance.ok; metrics.firstRelevantTotal += initialFidelity.relevance.total;
    }
    const firstFidelityErrors = initialFidelity?.findings.length ?? 0;
    if (c.expected !== "KNOWN_LIMITATION_EXPECTED_REJECT") metrics.goalCapTotal++;
    if (out.repairUsed) metrics.repairCount++;
    metrics.maxRepairCalls = Math.max(metrics.maxRepairCalls, repairCandidates.length);
    if (c.expected === "COMPILE_OK") {
      metrics.supportedTotal++;
      metrics.coreTotal++;
      if (out.status === "PARSER_ACCEPTED") metrics.compileSuccess++;
      if (out.spec && semanticEqual(out.spec, c.golden)) metrics.coreMatches++;
    } else if (c.expected === "ENGINE_UNSUPPORTED") {
      metrics.unsupportedTotal++;
      if (out.status === "ENGINE_UNSUPPORTED") metrics.unsupportedCorrect++;
      if (out.status === "ENGINE_UNSUPPORTED" && out.spec && !semanticEqual(out.spec, c.golden)) metrics.unsupportedSemanticCorruption++;
    } else {
      metrics.knownLimitTotal++;
      if (out.status === "PARSE_FAILED" && out.errors.some((e: any) => e.code === "E_PROVENANCE_GROUNDING")) metrics.knownLimitCorrect++;
    }
    if (out.spec && out.spec.goals?.length && out.spec.goals.every((g: any) => g.capabilityId === c.golden.goals[0]?.capabilityId)) metrics.goalCapCorrect++;

    const outcomeValid = c.expected === "COMPILE_OK" ? out.status === "PARSER_ACCEPTED"
      : c.expected === "ENGINE_UNSUPPORTED" ? out.status === "ENGINE_UNSUPPORTED"
      : out.status === "PARSE_FAILED" && out.errors.some((e: any) => e.code === "E_PROVENANCE_GROUNDING");
    if (outcomeValid) metrics.validOutcomes++;
    if (out.domain === c.domain) metrics.domainCorrect++;
    if (out.status === "PARSER_ACCEPTED") metrics.accepted++;
    else if (out.status === "ENGINE_UNSUPPORTED") metrics.engineUnsupported++;
    else metrics.rejected++;
    if (out.repairUsed && a1 && finalCandidate && semanticEqual(a1, c.golden) && !semanticEqual(finalCandidate, c.golden)) metrics.repairRegressions++;

    if (out.status === "PARSER_ACCEPTED" && out.spec) {
      const finalFidelity = fidelityRates(out.spec, c.statement);
      if (finalFidelity) {
        metrics.finalDeclaredOk += finalFidelity.declared.ok; metrics.finalDeclaredTotal += finalFidelity.declared.total;
        metrics.finalExprOk += finalFidelity.expression.ok; metrics.finalExprTotal += finalFidelity.expression.total;
        metrics.finalRelevantOk += finalFidelity.relevance.ok; metrics.finalRelevantTotal += finalFidelity.relevance.total;
        if (c.expected === "COMPILE_OK" && !semanticEqual(out.spec, c.golden) && finalFidelity.findings.length === 0) metrics.silentFidelityErrors++;
      }
      const g19 = groundProblemSpec(out.spec, c.statement);
      metrics.g19Grounded += g19.semanticGroundedCount; metrics.g19Total += g19.semanticTotal;
      metrics.leaks += leakScan(out.spec).length;
    }

    if (firstFidelityErrors > 0 && out.repairUsed) {
      metrics.fidelityRepairAttempts++;
      if (out.status === "PARSER_ACCEPTED" && out.spec && semanticEqual(out.spec, c.golden) && fidelityRates(out.spec, c.statement).findings.length === 0) metrics.fidelityRepairSuccess++;
    }

    if (c.challengeType) {
      const cs = challengeStats[c.challengeType];
      cs.total++;
      if (out.repairUsed) cs.repairs++;
      if (!out.repairUsed || (out.diagnostics ?? []).filter((d: any) => d.stage === "repair").length === 1) cs.noSecondRepair++;
      const fidelityOrGroundingError = [...(out.errors ?? []), ...(out.diagnostics ?? []).flatMap((d: any) => d.errors ?? [])].some((e: any) => ["E_SOURCE_COMPLETENESS", "E_SOURCE_EXPRESSION_LOSS", "E_SOURCE_IRRELEVANT", "E_PROVENANCE_GROUNDING"].includes(e.code));
      const correct = out.status === "PARSER_ACCEPTED" && out.spec && semanticEqual(out.spec, c.golden);
      const detectedFailClosed = out.status === "PARSE_FAILED" && fidelityOrGroundingError;
      if (correct || detectedFailClosed) cs.detectedOrCorrect++;
      if (correct) cs.acceptedCoreMatches++;
      if (out.status === "PARSER_ACCEPTED" && out.spec && !semanticEqual(out.spec, c.golden) && !fidelityOrGroundingError) cs.silentAcceptedWrong++;
      if (out.repairUsed && a1 && finalCandidate && semanticEqual(a1, c.golden) && !semanticEqual(finalCandidate, c.golden)) cs.regressions++;
    }

    const row = {
      id: c.id, domain: c.domain, category: c.category, challengeType: c.challengeType ?? null, expected: c.expected,
      status: out.status, repairUsed: out.repairUsed, semanticMatch: out.spec ? semanticEqual(out.spec, c.golden) : null,
      initialFidelity: initialFidelity ? { declared: initialFidelity.declared, expression: initialFidelity.expression, relevance: initialFidelity.relevance, findings: initialFidelity.findings.map((f: any) => ({ code: f.code, path: f.path })) } : null,
      finalGrounding: out.spec ? groundProblemSpec(out.spec, c.statement) : null,
      errors: out.errors,
    };
    rows.push(row);
    diagnostics.push({ id: c.id, statement: c.statement, calls: out.diagnostics, errors: out.errors, finalStatus: out.status });
    console.log(`${outcomeValid ? "ok " : "DIFF"} ${c.id} -> ${out.status}${out.repairUsed ? " (repair)" : ""}${row.semanticMatch === false ? " [core_mismatch]" : ""}`);
  }

  const rate = (a: number, b: number) => b ? a / b : 1;
  const challengeMetrics: any = {};
  for (const [k, v] of Object.entries(challengeStats)) {
    const pass = k === "multi-finding-one-repair"
      ? v.total === 6 && v.noSecondRepair === 6 && v.regressions === 0 && v.silentAcceptedWrong === 0
      : v.total === 6 && v.detectedOrCorrect === 6 && v.silentAcceptedWrong === 0;
    challengeMetrics[k] = { ...v, detected_or_correct_rate: rate(v.detectedOrCorrect, v.total), accepted_core_match_rate: rate(v.acceptedCoreMatches, v.total), pass };
  }
  const challengeAcceptedCoreMatches = Object.values(challengeStats).reduce((sum, x) => sum + x.acceptedCoreMatches, 0);
  const finalSchemaValid = rate(metrics.validOutcomes, cases.length);
  const coreMatch = rate(metrics.coreMatches, metrics.coreTotal);
  const goalCapability = rate(metrics.goalCapCorrect, metrics.goalCapTotal);
  const compileSuccess = rate(metrics.compileSuccess, metrics.supportedTotal);
  const g19Rate = rate(metrics.g19Grounded, metrics.g19Total);
  const thresholds: any = {
    final_schema_semantic_valid: 0.98,
    core_semantic_match: 0.95,
    goal_capability_accuracy: 0.95,
    supported_compile_success: 0.90,
    unsupported_refused_correctly: 1.0,
    known_limitation_expected_reject: 1.0,
    g19_final_grounding: 0.985,
    answer_leaks: 0,
    repair_semantic_regressions: 0,
    silent_fidelity_error_count: 0,
    repair_budget_per_case: 1,
    challenge_detected_or_correct: "6/6 each type",
  };
  const checks: [string, boolean][] = [
    ["final_schema_semantic_valid", finalSchemaValid >= thresholds.final_schema_semantic_valid],
    ["core_semantic_match", coreMatch >= thresholds.core_semantic_match],
    ["goal_capability_accuracy", goalCapability >= thresholds.goal_capability_accuracy],
    ["supported_compile_success", compileSuccess >= thresholds.supported_compile_success],
    ["unsupported_refused_6_of_6", metrics.unsupportedCorrect === metrics.unsupportedTotal && metrics.unsupportedTotal === 6],
    ["unsupported_semantic_corruption_zero", metrics.unsupportedSemanticCorruption === 0],
    ["known_limitation_expected_reject", metrics.knownLimitCorrect === metrics.knownLimitTotal && metrics.knownLimitTotal === 2],
    ["g19_final_grounding", g19Rate >= thresholds.g19_final_grounding],
    ["answer_leaks_zero", metrics.leaks === 0],
    ["repair_semantic_regressions_zero", metrics.repairRegressions === 0],
    ["silent_fidelity_errors_zero", metrics.silentFidelityErrors === 0],
    ["challenge_cases_detected_or_correct", Object.values(challengeMetrics).every((x: any) => x.pass)],
    ["challenge_accepted_core_match_22_of_24", challengeAcceptedCoreMatches >= 22],
    ["repair_at_most_one_per_case", metrics.maxRepairCalls <= 1],
  ];
  const summary = {
    gate: "G20_P5_3_benchmark_v3", version: "P5.3", mode, provider: live?.id ?? "golden-replay",
    freeze: { dataset_sha256: freeze.dataset_sha256, scoring_policy_sha256: freeze.scoring_policy_sha256, authority: freeze.hash_authority, freeze_commit: freeze.verified_freeze_commit },
    cases: cases.length, token_usage: { total: tokenTotals, per_case_average: { input_tokens: Math.round(tokenTotals.input_tokens / cases.length), output_tokens: Math.round(tokenTotals.output_tokens / cases.length) } },
    metrics: {
      domain_accuracy: rate(metrics.domainCorrect, cases.length), final_schema_semantic_valid: finalSchemaValid,
      core_semantic_match: { matched: metrics.coreMatches, total: metrics.coreTotal, rate: coreMatch },
      goal_capability_accuracy: goalCapability, supported_compile_success: compileSuccess,
      unsupported_refused_correctly: { refused: metrics.unsupportedCorrect, total: metrics.unsupportedTotal }, unsupported_semantic_corruption: metrics.unsupportedSemanticCorruption,
      known_limitation_expected_reject: { rejected: metrics.knownLimitCorrect, total: metrics.knownLimitTotal },
      g19_final_grounding: { grounded: metrics.g19Grounded, total: metrics.g19Total, rate: g19Rate },
      declared_entity_completeness: { first_pass: ratios(metrics.firstDeclaredOk, metrics.firstDeclaredTotal), final: ratios(metrics.finalDeclaredOk, metrics.finalDeclaredTotal) },
      expression_fidelity: { first_pass: ratios(metrics.firstExprOk, metrics.firstExprTotal), final: ratios(metrics.finalExprOk, metrics.finalExprTotal) },
      goal_relevance_precision: { first_pass: ratios(metrics.firstRelevantOk, metrics.firstRelevantTotal), final: ratios(metrics.finalRelevantOk, metrics.finalRelevantTotal) },
      silent_fidelity_error_count: metrics.silentFidelityErrors,
      fidelity_repair_success_rate: { succeeded: metrics.fidelityRepairSuccess, attempted: metrics.fidelityRepairAttempts, rate: metrics.fidelityRepairAttempts ? metrics.fidelityRepairSuccess / metrics.fidelityRepairAttempts : null },
      repair_semantic_regressions: metrics.repairRegressions, repair_count: metrics.repairCount, max_repair_calls_per_case: metrics.maxRepairCalls, challenge_accepted_core_matches: { matched: challengeAcceptedCoreMatches, total: 24, rate: challengeAcceptedCoreMatches / 24 },
      answer_leaks: metrics.leaks, final_acceptance: { accepted: metrics.accepted, engine_unsupported: metrics.engineUnsupported, rejected: metrics.rejected, total: cases.length },
      challenge_metrics: challengeMetrics,
    }, thresholds, checks: checks.map(([name, pass]) => ({ name, pass })),
    result: checks.every(([, pass]) => pass) ? "PASS" : "FAIL",
  };
  fs.writeFileSync(path.join(OUT_DIR, "benchmark-v3.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "benchmark-v3-rows.json"), JSON.stringify(rows, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "benchmark-v3-diagnostics.json"), JSON.stringify(diagnostics, null, 2) + "\n", "utf8");
  for (const [k, v] of Object.entries(summary.metrics)) console.log(`${k}: ${typeof v === "number" ? v.toFixed(4) : JSON.stringify(v)}`);
  for (const c of checks) console.log(`${c[1] ? "PASS" : "FAIL"} ${c[0]}`);
  console.log(`${summary.gate}: ${summary.result} (${mode})`);
  if (requireLive && summary.result !== "PASS") process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
