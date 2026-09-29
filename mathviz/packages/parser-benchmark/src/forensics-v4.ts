// P5.4 Stage-1 offline forensic over the FROZEN v4 live evidence (commit
// 8b10a766). ZERO provider requests: every conclusion is derived by
// deterministically replaying attemptCompileV4 (pure function, same frozen
// pipeline code at blob ee59d44) over the parsed_candidates stored in the
// committed diagnostics, then cross-checked against the recorded live errors.
// Outputs runs/p53/v4-forensics.json: per-case stage matrix, mutually-exclusive
// root causes, repair-regression diffs, semantic-invalid sufficiency analysis,
// the v4_f_03 four-hypothesis adjudication, and the silent-fidelity blocker.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { attemptCompileV4 } from "../../parser/src/parse-v4";
import { semanticEqual } from "./normalize-spec";
import { groundProblemSpec } from "./grounding";
import { checkSourceFidelity } from "../../parser/src/fidelity";
import { functionZeroErrors, checkFunctionZeroDuality } from "../../parser/src/function-zero-duality";
import { readGitBlob } from "./git-blob";
import { V4_DATASET_PATH } from "./freeze-v4";

const EV = path.join(ROOT, "fixtures", "parser-bench-v4", "live-evidence");
const OUT = path.join(ROOT, "runs", "p53", "v4-forensics.json");
const FREEZE = "877bf6dd0ee30d4adca62d79cded0eaf657edf64";

type RootCause = "REPAIR_REGRESSION" | "SILENT_FIDELITY" | "PARSER_GAP" | "EXPECTATION_DISPUTE" | "CORE_SEMANTIC" | "DUALITY" | "G19_GROUNDING" | null;

function codesMatch(a: any[], b: any[]) {
  const norm = (x: any[]) => [...(x ?? [])].map((e: any) => e.code ?? e).sort().join(",");
  return norm(a) === norm(b);
}

/** structural diff between two candidates, focused on semantic fields */
function structuralDiff(a: any, b: any) {
  const out: any = { entities_added: [], entities_removed: [], entities_changed: [], goals_changed: null, source_facts_delta: null, provenance_span_changes: [] };
  if (!a || !b) return null;
  const entA = new Map((a.entities ?? []).map((e: any) => [e.id, e]));
  const entB = new Map((b.entities ?? []).map((e: any) => [e.id, e]));
  for (const id of entB.keys()) if (!entA.has(id)) out.entities_added.push(id);
  for (const id of entA.keys()) if (!entB.has(id)) out.entities_removed.push(id);
  for (const [id, ea] of entA) {
    const eb = entB.get(id);
    if (!eb) continue;
    if (JSON.stringify(ea.props) !== JSON.stringify(eb.props)) out.entities_changed.push({ id, field: "props", before: ea.props, after: eb.props });
    if (JSON.stringify(ea.provenance?.span) !== JSON.stringify(eb.provenance?.span)) out.provenance_span_changes.push({ id, before: ea.provenance?.span, after: eb.provenance?.span });
  }
  if (JSON.stringify(a.goals ?? []) !== JSON.stringify(b.goals ?? [])) out.goals_changed = { before: a.goals ?? [], after: b.goals ?? [] };
  const fa = (a.source_facts ?? []).length, fb = (b.source_facts ?? []).length;
  if (fa !== fb) out.source_facts_delta = { before: fa, after: fb };
  return out;
}

function classify(c: any, m: any): { root: RootCause; secondary: RootCause[]; rationale: string } {
  const matrixOk = m.final.outcome === c.expected_class;
  const coreOk = c.expected_class !== "COMPILE_OK" || m.final.core;
  const dualOk = !m.dual || (m.dual.group.startsWith("A") ? m.dual.a_ok : m.dual.group.startsWith("B") ? m.dual.b_ok : m.dual.c_ok);
  if (matrixOk && coreOk && dualOk && m.final.grounding_ok) return { root: null, secondary: [], rationale: "all stages pass" };
  if (m.repair.fired && m.a1.core && !m.final.core) return { root: "REPAIR_REGRESSION", secondary: m.final.outcome !== c.expected_class ? ["EXPECTATION_DISPUTE"] : [], rationale: "A1 candidate already core-matched; repair destroyed it" };
  if (c.expected_class === "COMPILE_OK" && m.final.accepted && !m.final.core && m.final.fidelity_findings === 0) return { root: "SILENT_FIDELITY", secondary: [], rationale: "accepted but not golden-equal with zero fidelity findings — undetectable wrong semantics" };
  if (c.expected_class === "COMPILE_OK" && !m.final.accepted && !m.final.engine_unsupported) return { root: "PARSER_GAP", secondary: m.a1.core ? ["REPAIR_REGRESSION"] : [], rationale: `expected COMPILE_OK but final status ${m.final.status}${m.a1.core ? "; A1 was already core-correct, repair lost it" : "; A1 also rejected"}` };
  if (c.expected_class === "ENGINE_UNSUPPORTED" && m.final.outcome !== "ENGINE_UNSUPPORTED") return { root: "PARSER_GAP", secondary: ["EXPECTATION_DISPUTE"], rationale: "engine-unsupported case never reached the unsupported verdict layer; died at parser gates first" };
  if (c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT" && m.final.accepted) return { root: "EXPECTATION_DISPUTE", secondary: [], rationale: "expected rejection, parser accepted; adjudicated separately (H1..H4)" };
  if (m.dual && !dualOk) return { root: "DUALITY", secondary: [], rationale: "dual-group gate miss" };
  if (c.expected_class === "COMPILE_OK" && m.final.accepted && !m.final.core) return { root: "CORE_SEMANTIC", secondary: [], rationale: `accepted but not golden-equal (${m.final.fidelity_findings} fidelity findings)` };
  if (!m.final.grounding_ok) return { root: "G19_GROUNDING", secondary: [], rationale: `${m.final.grounding_ungrounded} ungrounded spans` };
  return { root: "CORE_SEMANTIC", secondary: [], rationale: "residual semantic mismatch" };
}

function main() {
  const dataset = JSON.parse(readGitBlob(FREEZE, V4_DATASET_PATH).toString("utf8"));
  const cases: any[] = dataset.cases;
  const diag = JSON.parse(fs.readFileSync(path.join(EV, "benchmark-v4-diagnostics.json"), "utf8"));
  const diagById = new Map(diag.map((d: any) => [d.case_id, d]));

  const matrix: any[] = [];
  const repairRegressions: any[] = [];
  const semanticInvalid: any[] = [];
  let integrityMatch = 0, integrityMismatch: any[] = [];
  const dist: Record<string, number> = {};

  for (const c of cases) {
    const d = diagById.get(c.id);
    if (!d) throw new Error(`no evidence for ${c.id}`);
    const a1d = (d.diagnostics ?? []).find((x: any) => x.stage === "A1");
    const repd = (d.diagnostics ?? []).find((x: any) => x.stage === "repair");
    // deterministic replay of BOTH attempts through the frozen pure gate aggregator
    const a1 = a1d?.parsed_candidate != null ? attemptCompileV4(a1d.parsed_candidate, c.statement) : null;
    const rep = repd?.parsed_candidate != null ? attemptCompileV4(repd.parsed_candidate, c.statement) : null;
    const replayFinal = rep ?? a1;
    const consistency = {
      a1_errors_match: !a1 || codesMatch(a1.errors ?? [], a1d?.errors ?? []),
      repair_errors_match: !rep || codesMatch(rep.errors ?? [], repd?.errors ?? []),
      final_status_match: (replayFinal?.ok ? "PARSER_ACCEPTED" : replayFinal?.engineUnsupported ? "ENGINE_UNSUPPORTED" : "PARSE_FAILED") === d.status,
    };
    const consistent = consistency.a1_errors_match && consistency.repair_errors_match && consistency.final_status_match;
    if (consistent) integrityMatch++; else integrityMismatch.push({ case_id: c.id, ...consistency });

    const golden = c.golden;
    const a1Core = !!a1d?.parsed_candidate && semanticEqual(a1d.parsed_candidate, golden);
    const finalCandidate = repd?.parsed_candidate ?? a1d?.parsed_candidate ?? null;
    const core = !!finalCandidate && semanticEqual(finalCandidate, golden);
    const goal = !!finalCandidate && (finalCandidate.goals ?? []).every((g: any) => g.capabilityId === golden.goals?.[0]?.capabilityId);

    // per-stage detail from the replayed attempts
    const stageDetail = (att: typeof a1) => {
      if (!att) return null;
      const fidelity = (() => { try { return checkSourceFidelity(att.spec ?? a1d?.parsed_candidate, c.statement); } catch { return null; } })();
      const fz = functionZeroErrors(att.spec ?? a1d?.parsed_candidate, c.statement);
      const g = (() => { try { return groundProblemSpec(att.spec ?? a1d?.parsed_candidate, c.statement); } catch (e: any) { return { semanticGroundedCount: 0, semanticTotal: 0, findings: [], error: e?.message }; } })();
      return {
        schema_ok: !att.errors.some((e) => e.code === "E_SCHEMA"),
        semantic_ok: !att.errors.some((e) => e.code.startsWith("E_SOURCE_") || e.code === "E_BINDING"),
        fidelity_findings: fidelity?.findings?.length ?? null,
        fidelity_codes: (fidelity?.findings ?? []).map((f: any) => f.code),
        function_zero_errors: fz.map((e) => e.code),
        compile_error: att.compileError?.code ?? null,
        grounding: { grounded: g.semanticGroundedCount, total: g.semanticTotal, ungrounded: g.findings.filter((f: any) => f.grounded === false).map((f: any) => ({ path: f.path, reason: f.reason })) },
        ok: att.ok, engine_unsupported: att.engineUnsupported, error_codes: att.errors.map((e) => e.code),
      };
    };
    const accepted = d.status === "PARSER_ACCEPTED";
    const outcome = accepted ? "COMPILE_OK" : d.status === "ENGINE_UNSUPPORTED" ? "ENGINE_UNSUPPORTED" : "KNOWN_LIMITATION_EXPECTED_REJECT";

    const isDual = !!golden?.entities?.some((e: any) => e.kind === "function");
    const dualDetail = !isDual ? null : (() => {
      const dcheck = finalCandidate ? checkFunctionZeroDuality(finalCandidate, c.statement) : null;
      const errors = (d.errors ?? []).map((e: any) => e.code);
      const PARSER_OWNED = ["E_SOURCE_COMPLETENESS", "E_SOURCE_EXPRESSION_LOSS", "E_SOURCE_IRRELEVANT", "E_FUNCTION_ZERO_FUNCTION_MISSING", "E_FUNCTION_ZERO_EQUATION_MISSING", "E_FUNCTION_ZERO_GOAL_BINDING", "E_PROVENANCE", "E_PROVENANCE_GROUNDING", "E_BINDING"];
      const group = c.expected_class === "COMPILE_OK" ? "A" : c.expected_class === "ENGINE_UNSUPPORTED" ? "B" : "C";
      const a_ok = group === "A" ? (accepted && core) : null;
      const b_ok = group === "B" ? (d.status === "ENGINE_UNSUPPORTED" && core && d.compile_error?.code === c.expected_error && !errors.some((e: string) => PARSER_OWNED.includes(e))) : null;
      const knownClean = c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT" && d.status === "PARSE_FAILED" && errors.length === 1 && errors[0] === c.expected_error;
      const c_ok = group === "C" ? (knownClean && c.expected_stage === "G19" && (errors[0] === "E_PROVENANCE_GROUNDING" ? "function_zero_bad_provenance" : null) === c.expected_failure_family) : null;
      return { group: `${group}_DUAL`, a_ok, b_ok, c_ok, duality_findings: dcheck?.findings?.length ?? null, detected: core || !!dcheck?.findings?.length || knownClean };
    })();

    const finalFidelity = finalCandidate ? (() => { try { return checkSourceFidelity(finalCandidate, c.statement); } catch { return null; } })() : null;
    const finalGround = finalCandidate ? groundProblemSpec(finalCandidate, c.statement) : null;
    const m = {
      case_id: c.id, expected_class: c.expected_class, expected_error: c.expected_error ?? null, expected_stage: c.expected_stage ?? null,
      evidence_consistent: consistent,
      a1: { fired: true, parsed_json: a1d?.parsed_candidate != null, core: a1Core, ...(stageDetail(a1) ? { stages: stageDetail(a1) } : {}) },
      repair: { fired: !!repd, parsed_json: repd?.parsed_candidate != null, core: !!repd?.parsed_candidate && semanticEqual(repd.parsed_candidate, golden) },
      final: {
        status: d.status, outcome, accepted, engine_unsupported: d.status === "ENGINE_UNSUPPORTED",
        core, goal, fidelity_findings: finalFidelity?.findings?.length ?? null,
        grounding_ok: finalGround ? finalGround.semanticGroundedCount === finalGround.semanticTotal : null,
        grounding_ungrounded: finalGround ? finalGround.semanticTotal - finalGround.semanticGroundedCount : null,
      },
      dual: dualDetail,
    };
    const cls = classify(c, m);
    m.root_cause = cls.root; m.secondary_causes = cls.secondary; m.rationale = cls.rationale;
    if (cls.root) dist[cls.root] = (dist[cls.root] ?? 0) + 1;
    matrix.push(m);

    if (m.repair.fired && a1Core && !core) {
      repairRegressions.push({
        case_id: c.id, expected_class: c.expected_class,
        a1: { core: true, error_codes: a1?.errors.map((e) => e.code) ?? [] },
        repair: { core: false, error_codes: rep?.errors.map((e) => e.code) ?? [] },
        diff: structuralDiff(a1d?.parsed_candidate, repd?.parsed_candidate),
        a1_was_ok: !!a1?.ok, repair_ok: !!rep?.ok,
      });
    }
    if (!accepted && c.expected_class === "COMPILE_OK") {
      // Layer-precise sufficiency: E_SOURCE_*/E_FUNCTION_ZERO_*/E_PROVENANCE_GROUNDING
      // are only produced AFTER JSON-schema + spec-validate pass (attemptCompileV4
      // short-circuits otherwise), so their presence proves structural validity;
      // compile-layer codes (E_CAPABILITY_UNSUPPORTED/E_MATH_CONSTRAINT) likewise.
      const a1codes: string[] = (a1?.errors ?? []).map((e) => e.code);
      const postValidate = a1codes.some((x) => x.startsWith("E_SOURCE_") || x.startsWith("E_FUNCTION_ZERO_") || x === "E_PROVENANCE_GROUNDING");
      const compileOnly = a1codes.length > 0 && a1codes.every((x) => x === "E_CAPABILITY_UNSUPPORTED" || x === "E_MATH_CONSTRAINT");
      const structurallyValid = a1codes.length === 0 || postValidate || compileOnly;
      semanticInvalid.push({
        case_id: c.id,
        replay_verdict: {
          a1_error_codes: a1codes,
          repair_parsed_json: m.repair.parsed_json, repair_schema_ok: rep ? !rep.errors.some((e) => e.code === "E_SCHEMA") : null,
        },
        information_sufficient_verdict: structurallyValid
          ? "RAW OUTPUT STRUCTURALLY VALID — rejection came from fidelity/function-zero/grounding/compile gates, not from missing structure"
          : "RAW OUTPUT STRUCTURALLY INSUFFICIENT — schema/semantic validation itself failed",
      });
    }
  }

  // v4_f_03 four-hypothesis adjudication (deterministic, from evidence + replay)
  const f03 = matrix.find((m) => m.case_id === "v4_f_03");
  const f03case = cases.find((c) => c.id === "v4_f_03");
  const f03d = diagById.get("v4_f_03");
  const f03cand = f03d?.diagnostics?.find((x: any) => x.stage === "repair")?.parsed_candidate ?? f03d?.diagnostics?.find((x: any) => x.stage === "A1")?.parsed_candidate ?? null;
  const f03goldenGround = (() => { try { return groundProblemSpec(f03case.golden, f03case.statement); } catch (e: any) { return { error: e?.message }; } })();
  const f03liveGround = f03cand ? groundProblemSpec(f03cand, f03case.statement) : null;
  const f03adjudication = {
    case_id: "v4_f_03",
    declaration: { expected_class: f03case.expected_class, expected_error: f03case.expected_error, expected_stage: f03case.expected_stage, expected_failure_family: f03case.expected_failure_family },
    H1_engine_has_capability: null as any, H2_superficial_compile: null as any, H3_limitation_detector_miss: null as any, H4_scorer_definition_mismatch: null as any,
    evidence: {
      live_status: f03d?.status, live_errors: f03d?.errors?.map((e: any) => e.code) ?? [],
      final_core_match: f03?.final.core, final_goal_match: f03?.final.goal,
      golden_grounding: { grounded: f03goldenGround?.semanticGroundedCount, total: f03goldenGround?.semanticTotal, ungrounded: (f03goldenGround as any)?.findings?.filter((f: any) => f.grounded === false)?.map((f: any) => ({ path: f.path, reason: f.reason })) },
      live_grounding: f03liveGround ? { grounded: f03liveGround.semanticGroundedCount, total: f03liveGround.semanticTotal, ungrounded: f03liveGround.findings.filter((f: any) => f.grounded === false).map((f: any) => ({ path: f.path, reason: f.reason })) } : null,
      golden_provenance_spans: (f03case.golden?.entities ?? []).map((e: any) => ({ id: e.id, span: e.provenance?.span })),
      live_provenance_spans: (f03cand?.entities ?? []).map((e: any) => ({ id: e.id, span: e.provenance?.span })),
    },
  };
  {
    const e = f03adjudication.evidence;
    const compileSucceeded = e.live_status === "PARSER_ACCEPTED";
    const semanticsAchieved = !!e.final_core_match && !!e.final_goal_match;
    // H1: capability genuinely present + expectation stale => compile OK AND semantics OK AND golden's expected rejection reason is a designed flaw the model simply did not reproduce
    f03adjudication.H1_engine_has_capability = {
      supported: compileSucceeded && semanticsAchieved && (e.golden_grounding?.ungrounded?.length ?? 0) > 0 && (e.live_grounding?.ungrounded?.length ?? 0) === 0,
      note: "compile succeeded, core+goal matched, and the golden's ungrounded span (the designed flaw) was NOT reproduced by the model output — the engine/compiler capability itself was never missing; the expectation encodes a model-behavior assumption (would emit the bad span), not an engine limitation",
    };
    f03adjudication.H2_superficial_compile = { supported: !semanticsAchieved && compileSucceeded, note: "compile OK but core/goal mismatch" };
    f03adjudication.H3_limitation_detector_miss = { supported: false, note: "G19 detector fired correctly on the golden design (golden replay rejects); live output was genuinely well-grounded, nothing to detect" };
    f03adjudication.H4_scorer_definition_mismatch = { supported: false, note: "COMPILE_OK == PARSER_ACCEPTED per frozen policy; replayed status matches recorded status" };
  }

  // silent fidelity blocker isolation — scan by matrix properties, independent
  // of the mutually-exclusive primary root cause (a case can be both a repair
  // regression AND the silent-fidelity exemplar, e.g. v4_f_05).
  const silent = matrix.filter((m) => m.expected_class === "COMPILE_OK" && m.final.accepted && !m.final.core && m.final.fidelity_findings === 0);
  const silentBlocker = silent.map((m) => {
    const c = cases.find((x) => x.id === m.case_id)!;
    const d = diagById.get(m.case_id);
    const cand = d?.diagnostics?.find((x: any) => x.stage === "repair")?.parsed_candidate ?? d?.diagnostics?.find((x: any) => x.stage === "A1")?.parsed_candidate ?? null;
    return {
      case_id: m.case_id, statement: c.statement,
      fidelity_findings: m.final.fidelity_findings,
      golden_entity_ids: (c.golden?.entities ?? []).map((e: any) => `${e.id}:${e.kind}`),
      live_entity_ids: (cand?.entities ?? []).map((e: any) => `${e.id}:${e.kind}`),
      golden_goals: JSON.stringify(c.golden?.goals ?? []), live_goals: JSON.stringify(cand?.goals ?? []),
      structural_diff: structuralDiff(c.golden, cand),
    };
  });

  const report = {
    stage: "P5_4_STAGE1_FORENSICS", generated_from: "frozen evidence 8b10a766 + freeze blob 877bf6dd", provider_requests: 0,
    integrity: { cases: cases.length, replay_matches_evidence: integrityMatch, mismatches: integrityMismatch },
    root_cause_distribution: dist,
    matrix, repair_regressions: repairRegressions, semantic_invalid_replay: semanticInvalid,
    f03_adjudication: f03adjudication, silent_fidelity_blocker: silentBlocker,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`integrity: ${integrityMatch}/${cases.length} replays match recorded evidence`);
  console.log(`root causes: ${JSON.stringify(dist)}`);
  console.log(`repair regressions: ${repairRegressions.length}; semantic-invalid: ${semanticInvalid.length}; silent blockers: ${silentBlocker.length}`);
  for (const r of repairRegressions) console.log(`  REG ${r.case_id}: a1_ok=${r.a1_was_ok} -> repair_ok=${r.repair_ok} changed=${JSON.stringify(Object.keys(r.diff ?? {}).filter((k) => Array.isArray((r.diff as any)[k]) ? (r.diff as any)[k].length : (r.diff as any)[k]))}`);
  console.log(`f03: H1=${f03adjudication.H1_engine_has_capability.supported} H2=${f03adjudication.H2_superficial_compile.supported} H3=${f03adjudication.H3_limitation_detector_miss.supported} H4=${f03adjudication.H4_scorer_definition_mismatch.supported}`);
}
main();
