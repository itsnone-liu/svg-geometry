// P5.4 Stage-3 acceptance gates (owner-specified). Deterministic, offline,
// zero provider requests. The frozen v4 live A1/repair evidence becomes the
// P5.4 regression corpus:
//   G-P54-1  10 historical regression A1 + canonical label counterfactual
//            -> 8 supported PASS + 2 unsupported clean ENGINE_UNSUPPORTED,
//            parser-owned errors = 0.
//   G-P54-2  10/10 historical destructive repair goal mutations
//            rejected/protected by the mutation audit.
//   G-P54-3  silent goal-input over-reference accepted = 0 (v4_f_05 must no
//            longer be silently accepted).
// Plus a full 72-case v4-evidence replay through attemptCompileV5 as
// COUNTERFACTUAL REMEDIATION EVIDENCE ONLY — the v4 live verdict stays FAIL.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { attemptCompileV5 } from "../../parser/src/parse-v5";
import { auditRepairV5 } from "../../parser/src/repair-v5";
import { readGitBlob } from "./git-blob";
import { V4_DATASET_PATH } from "./freeze-v4";

const EV = path.join(ROOT, "fixtures", "parser-bench-v4", "live-evidence");
const OUT = path.join(ROOT, "runs", "p53", "v4-gates-p54.json");
const FREEZE = "877bf6dd0ee30d4adca62d79cded0eaf657edf64";
const REG = ["v4_f_01", "v4_f_02", "v4_f_04", "v4_f_05", "v4_f_08", "v4_f_10", "v4_f_12", "v4_f_13", "v4_f_14", "v4_f_15"];
const UNSUPPORTED = new Set(["v4_f_01", "v4_f_02"]);
const clone = (x: any) => JSON.parse(JSON.stringify(x));

function main() {
  const dataset = JSON.parse(readGitBlob(FREEZE, V4_DATASET_PATH).toString("utf8"));
  const diag = JSON.parse(fs.readFileSync(path.join(EV, "benchmark-v4-diagnostics.json"), "utf8"));
  const stageOf = (d: any, stage: string) => d.diagnostics.find((x: any) => x.stage === stage);

  // G-P54-1 — label-only counterfactual on the 10 historical A1s.
  const g1: any[] = [];
  let g1Pass = 0;
  for (const id of REG) {
    const c = dataset.cases.find((x: any) => x.id === id);
    const a1 = stageOf(diag.find((x: any) => x.case_id === id), "A1").parsed_candidate;
    const cf = clone(a1);
    cf.entities.find((e: any) => e.kind === "function").label = c.golden.entities.find((e: any) => e.kind === "function").label;
    const att = attemptCompileV5(cf, c.statement);
    const parserOwned = att.errors.filter((e: any) => !(att.compileError && e.code === att.compileError.code && e.message === att.compileError.message));
    const want = UNSUPPORTED.has(id)
      ? { ok: false, eu: true, parserOwned: 0, only: c.expected_error }
      : { ok: true, eu: false, parserOwned: 0, only: null };
    const got = { ok: att.ok, eu: att.engineUnsupported, parserOwned: parserOwned.length, only: att.errors.length === 1 ? att.errors[0].code : null };
    const pass = got.ok === want.ok && got.eu === want.eu && got.parserOwned === want.parserOwned && got.only === want.only;
    if (pass) g1Pass++;
    g1.push({ case_id: id, want, got, pass, errors: att.errors.map((e: any) => e.code), suppressed: att.suppressedFindings });
  }

  // G-P54-2 — mutation audit over the 10 historical destructive repairs.
  const g2: any[] = [];
  let g2Pass = 0;
  for (const id of REG) {
    const c = dataset.cases.find((x: any) => x.id === id);
    const d = diag.find((x: any) => x.case_id === id);
    const a1 = stageOf(d, "A1").parsed_candidate;
    const repairDoc = stageOf(d, "repair")?.parsed_candidate ?? d.diagnostics[d.diagnostics.length - 1].parsed_candidate;
    const a1Attempt = attemptCompileV5(a1, c.statement);
    const audit = auditRepairV5(a1, repairDoc, a1Attempt.errors);
    const goalRestored = audit.protected_paths_restored.some((p) => /^\/goals\/[^/]+\/inputs$/.test(p));
    const pass = audit.verdict === "projected" && goalRestored;
    if (pass) g2Pass++;
    g2.push({ case_id: id, verdict: audit.verdict, protected_paths_restored: audit.protected_paths_restored, pass, notes: audit.audit_notes });
  }

  // G-P54-3 — silent over-reference accepted = 0 (f_05 must fail closed).
  const g3: any[] = [];
  const f05 = diag.find((x: any) => x.case_id === "v4_f_05");
  const f05c = dataset.cases.find((x: any) => x.id === "v4_f_05");
  const f05Repair = stageOf(f05, "repair")?.parsed_candidate ?? f05.diagnostics[f05.diagnostics.length - 1].parsed_candidate;
  const f05v5 = attemptCompileV5(f05Repair, f05c.statement);
  const hasOverref = f05v5.errors.some((e: any) => e.code === "E_FUNCTION_ZERO_GOAL_OVERREFERENCE");
  const silentAccepted = f05v5.ok;
  // all 10 historical repairs re-checked: none may be silently accepted with over-reference
  let silentCount = 0;
  for (const id of REG) {
    const c = dataset.cases.find((x: any) => x.id === id);
    const d = diag.find((x: any) => x.case_id === id);
    const repairDoc = stageOf(d, "repair")?.parsed_candidate ?? d.diagnostics[d.diagnostics.length - 1].parsed_candidate;
    if (!repairDoc) continue;
    const att = attemptCompileV5(repairDoc, c.statement);
    const overref = att.errors.some((e: any) => e.code === "E_FUNCTION_ZERO_GOAL_OVERREFERENCE");
    if (att.ok || (overref && att.ok)) silentCount += att.ok ? 1 : 0;
    g3.push({ case_id: id, v5_ok: att.ok, overref_detected: overref, errors: att.errors.map((e: any) => e.code) });
  }
  const g3Pass = !silentAccepted && hasOverref && silentCount === 0;

  // Counterfactual remediation evidence: 72-case replay (v4 verdict unchanged).
  const replay: any[] = [];
  for (const d of diag) {
    const c = dataset.cases.find((x: any) => x.id === d.case_id);
    const finalDoc = d.diagnostics[d.diagnostics.length - 1].parsed_candidate;
    if (!finalDoc) { replay.push({ case_id: d.case_id, skipped: true }); continue; }
    const v5 = attemptCompileV5(finalDoc, c.statement);
    replay.push({ case_id: d.case_id, v4_status: d.status ?? d.outcome?.status ?? null, v5: v5.ok ? "PARSER_ACCEPTED" : v5.engineUnsupported ? "ENGINE_UNSUPPORTED" : "PARSE_FAILED", v5_errors: v5.errors.map((e: any) => e.code) });
  }

  const report = {
    stage: "P5_4_STAGE3_ACCEPTANCE_GATES", provider_requests: 0,
    gates: {
      G_P54_1: { pass: g1Pass === REG.length, cleared: `${g1Pass}/${REG.length}`, rows: g1 },
      G_P54_2: { pass: g2Pass === REG.length, cleared: `${g2Pass}/${REG.length}`, rows: g2 },
      G_P54_3: { pass: g3Pass, f05: { v4_silent_accepted: true, v5_ok: f05v5.ok, overref_detected: hasOverref, errors: f05v5.errors.map((e: any) => e.code) }, silent_overref_accepted: silentCount, rows: g3 },
    },
    counterfactual_replay_72: { note: "remediation evidence ONLY — the v4 live verdict stays FAIL @8b10a76", rows: replay },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`G-P54-1 ${report.gates.G_P54_1.pass ? "PASS" : "FAIL"} (${g1Pass}/10)`);
  console.log(`G-P54-2 ${report.gates.G_P54_2.pass ? "PASS" : "FAIL"} (${g2Pass}/10)`);
  console.log(`G-P54-3 ${report.gates.G_P54_3.pass ? "PASS" : "FAIL"} (silent accepted=${silentCount}, f05 overref=${hasOverref})`);
  for (const r of g1) if (!r.pass) console.log(`  G1 MISS ${r.case_id}: ${JSON.stringify(r.got)} want ${JSON.stringify(r.want)}`);
  for (const r of g2) if (!r.pass) console.log(`  G2 MISS ${r.case_id}: ${r.verdict} ${JSON.stringify(r.protected_paths_restored)}`);
}
main();
