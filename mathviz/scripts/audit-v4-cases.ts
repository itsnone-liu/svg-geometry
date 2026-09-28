// C1 declaration-first audit. Expected labels are read-only declarations;
// this script never rewrites them from observed outcomes.
import fs from "node:fs";
import path from "node:path";
import { attemptCompileV4 } from "../packages/parser/src/parse-v4";
import { checkFunctionZeroDuality } from "../packages/parser/src/function-zero-duality";

const root = path.resolve(__dirname, "..");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "fixtures/parser-bench-v4/cases.json"), "utf8"));
const failures: string[] = [];
const expected = new Set(["COMPILE_OK", "ENGINE_UNSUPPORTED", "KNOWN_LIMITATION_EXPECTED_REJECT"]);
const outcome = (r: any) => r.ok ? "COMPILE_OK" : r.engineUnsupported ? "ENGINE_UNSUPPORTED" : "KNOWN_LIMITATION_EXPECTED_REJECT";
const rows = dataset.cases.map((c: any) => {
  if (!expected.has(c.expected_class)) failures.push(`${c.id}: invalid expected_class`);
  if (c.expected_class !== "COMPILE_OK" && !c.expected_error) failures.push(`${c.id}: refusal missing expected_error`);
  const r = attemptCompileV4(c.golden, c.statement);
  const actual = outcome(r);
  const expectedErrorPresent = c.expected_class === "COMPILE_OK" || r.errors.some((e: any) => e.code === c.expected_error);
  if (actual !== c.expected_class || !expectedErrorPresent) failures.push(`${c.id}: expected=${c.expected_class}/${c.expected_error ?? ""} actual=${actual} errors=${r.errors.map((e: any) => e.code).join(",")}`);
  if (c.expected_class === "ENGINE_UNSUPPORTED" && r.errors.some((e: any) => ["E_SOURCE_COMPLETENESS", "E_SOURCE_EXPRESSION_LOSS", "E_SOURCE_IRRELEVANT", "E_FUNCTION_ZERO_FUNCTION_MISSING", "E_FUNCTION_ZERO_EQUATION_MISSING", "E_FUNCTION_ZERO_GOAL_BINDING", "E_PROVENANCE", "E_PROVENANCE_GROUNDING"].includes(e.code))) failures.push(`${c.id}: engine case has parser-owned error`);
  return { id: c.id, expected: c.expected_class, actual, errors: r.errors.map((e: any) => e.code), pass: actual === c.expected_class && expectedErrorPresent };
});
const dual = dataset.cases.filter((c: any) => c.domain === "function2d" && c.golden.entities.some((e: any) => e.kind === "function"));
if (dual.length !== 15) failures.push(`dual count ${dual.length} != 15`);
for (const c of dual) { const r = checkFunctionZeroDuality(c.golden, c.statement); if (!r.applicable || r.findings.length) failures.push(`${c.id}: G20-D not clean/applicable (${JSON.stringify(r.findings)})`); }
const equationControls = dataset.cases.filter((c: any) => c.domain === "function2d" && !c.golden.entities.some((e: any) => e.kind === "function"));
for (const c of equationControls) if (checkFunctionZeroDuality(c.golden, c.statement).applicable) failures.push(`${c.id}: bare-equation control unexpectedly triggers G20-D`);
const counts = Object.fromEntries([...expected].map((k) => [k, dataset.cases.filter((c: any) => c.expected_class === k).length]));
const report = { version: dataset.version, total: dataset.cases.length, counts, dual_count: dual.length, equation_control_count: equationControls.length, passed: failures.length === 0, failures, rows };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
