// C1 declaration-first audit. Expected labels are read-only declarations;
// this script never rewrites them from observed outcomes.
import fs from "node:fs";
import path from "node:path";
import { attemptCompileV4 } from "../packages/parser/src/parse-v4";
import { checkFunctionZeroDuality } from "../packages/parser/src/function-zero-duality";

const root = path.resolve(__dirname, "..");
const datasetPath = process.env.V4_DATASET_PATH ?? path.join(root, "fixtures/parser-bench-v4/cases.json");
const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8").replace(/^\uFEFF/, ""));
const failures: string[] = [];
const expected = new Set(["COMPILE_OK", "ENGINE_UNSUPPORTED", "KNOWN_LIMITATION_EXPECTED_REJECT"]);
const outcome = (r: any) => r.ok ? "COMPILE_OK" : r.engineUnsupported ? "ENGINE_UNSUPPORTED" : "KNOWN_LIMITATION_EXPECTED_REJECT";
const parserOwned = new Set(["E_SOURCE_COMPLETENESS", "E_SOURCE_EXPRESSION_LOSS", "E_SOURCE_IRRELEVANT", "E_FUNCTION_ZERO_FUNCTION_MISSING", "E_FUNCTION_ZERO_EQUATION_MISSING", "E_FUNCTION_ZERO_GOAL_BINDING", "E_PROVENANCE", "E_PROVENANCE_GROUNDING", "E_BINDING"]);
const exactSlices = (c: any) => c.golden.entities.every((e: any) => { const s=e.provenance?.span; return !s || c.statement.slice(s.start,s.end) === s.text; });
const rows = dataset.cases.map((c: any) => {
  if (!expected.has(c.expected_class)) failures.push(`${c.id}: invalid expected_class`);
  if (c.expected_class !== "COMPILE_OK" && !c.expected_error) failures.push(`${c.id}: refusal missing expected_error`);
  const r = attemptCompileV4(c.golden, c.statement);
  const actual = outcome(r), actualErrors = r.errors.map((e: any) => e.code);
  const compileCode = r.compileError?.code ?? null;
  const actualStage = actual === "ENGINE_UNSUPPORTED" ? "compiler" : actual === "KNOWN_LIMITATION_EXPECTED_REJECT" ? "G19" : null;
  const actualFamily = actual === "KNOWN_LIMITATION_EXPECTED_REJECT" && actualErrors.length === 1 && actualErrors[0] === "E_PROVENANCE_GROUNDING" ? "function_zero_bad_provenance" : null;
  const classMatch = actual === c.expected_class;
  const stageMatch = (c.expected_stage ?? null) === actualStage;
  const errorMatch = c.expected_class === "COMPILE_OK" ? actualErrors.length === 0 : c.expected_class === "ENGINE_UNSUPPORTED" ? compileCode === c.expected_error : actualErrors.length === 1 && actualErrors[0] === c.expected_error;
  const familyMatch = c.expected_class !== "KNOWN_LIMITATION_EXPECTED_REJECT" || actualFamily === c.expected_failure_family;
  if (c.expected_class === "ENGINE_UNSUPPORTED" && (!r.engineUnsupported || compileCode !== c.expected_error || actualErrors.some((x: string) => parserOwned.has(x)))) failures.push(`${c.id}: engine contract mismatch errors=${actualErrors.join(",")}`);
  if (c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT" && (!exactSlices(c) || actualErrors.some((x: string) => ["E_SCHEMA","E_PROVENANCE","E_BINDING","E_CAPABILITY_UNSUPPORTED","E_MATH_CONSTRAINT"].includes(x)))) failures.push(`${c.id}: G19 contract contamination errors=${actualErrors.join(",")}`);
  if (!(classMatch && stageMatch && errorMatch && familyMatch)) failures.push(`${c.id}: declaration mismatch expected=${c.expected_class}/${c.expected_stage ?? ""}/${c.expected_error ?? ""}/${c.expected_failure_family ?? ""} actual=${actual}/${actualStage}/${compileCode ?? actualErrors.join(",")}/${actualFamily ?? ""}`);
  return { case_id:c.id, expected_class:c.expected_class, expected_stage:c.expected_stage ?? null, expected_error:c.expected_error ?? null, expected_failure_family:c.expected_failure_family ?? null, actual_class:actual, actual_stage:actualStage, actual_errors:actualErrors, actual_failure_family:actualFamily, class_match:classMatch, stage_match:stageMatch, error_match:errorMatch, family_match:familyMatch, pass:classMatch && stageMatch && errorMatch && familyMatch };
});
const dual = dataset.cases.filter((c: any) => c.domain === "function2d" && c.golden.entities.some((e: any) => e.kind === "function"));
if (dual.length !== 15) failures.push(`dual count ${dual.length} != 15`);
for (const c of dual) { const r = checkFunctionZeroDuality(c.golden, c.statement); if (!r.applicable || r.findings.length) failures.push(`${c.id}: G20-D not clean/applicable (${JSON.stringify(r.findings)})`); }
const equationControls = dataset.cases.filter((c: any) => c.domain === "function2d" && !c.golden.entities.some((e: any) => e.kind === "function"));
for (const c of equationControls) if (checkFunctionZeroDuality(c.golden, c.statement).applicable) failures.push(`${c.id}: bare-equation control unexpectedly triggers G20-D`);
const counts = Object.fromEntries([...expected].map((k) => [k, dataset.cases.filter((c: any) => c.expected_class === k).length]));
const scoringContract = { total:72, compile_ok:64, engine_unsupported:6, known_limitation:2, goal_capability_eligible:70, dual_cases:15, bare_equation_controls:9 };
if (scoringContract.compile_ok + scoringContract.engine_unsupported !== scoringContract.goal_capability_eligible) failures.push("goal capability denominator contract mismatch");
if (dataset.cases.length !== scoringContract.total || counts.COMPILE_OK !== scoringContract.compile_ok || counts.ENGINE_UNSUPPORTED !== scoringContract.engine_unsupported || counts.KNOWN_LIMITATION_EXPECTED_REJECT !== scoringContract.known_limitation || dual.length !== scoringContract.dual_cases || equationControls.length !== scoringContract.bare_equation_controls) failures.push(`scoring denominator contract mismatch: ${JSON.stringify({counts,dual:dual.length,controls:equationControls.length})}`);
const report = { version: dataset.version, total: dataset.cases.length, counts, scoring_contract:scoringContract, dual_count: dual.length, equation_control_count: equationControls.length, passed: failures.length === 0, failures, rows };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
