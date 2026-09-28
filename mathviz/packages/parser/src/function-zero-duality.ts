// P5.3 v4-only G20-D verifier.
// This module is intentionally not wired into the frozen v3 parser pipeline.
// It checks the existing compiler contract without changing that contract:
// solve_equation goals still point to equation entities, while an explicitly
// named function declaration must remain represented as a separate function.

import { scanSourceMath } from "./fidelity";

type Ast = any;

export type FunctionZeroDualityCode =
  | "E_FUNCTION_ZERO_FUNCTION_MISSING"
  | "E_FUNCTION_ZERO_EQUATION_MISSING"
  | "E_FUNCTION_ZERO_GOAL_BINDING"
  | "E_FUNCTION_ZERO_EXPRESSION_MISMATCH"
  | "E_FUNCTION_ZERO_RHS_NOT_ZERO";

export interface FunctionZeroDualityFinding {
  code: FunctionZeroDualityCode;
  path: string;
  message: string;
  repair_hint: string;
}

export interface FunctionZeroDualityResult {
  applicable: boolean;
  findings: FunctionZeroDualityFinding[];
}

function numericRat(ast: Ast): [bigint, bigint] | null {
  if (!ast || typeof ast !== "object") return null;
  if (ast.t === "num") {
    const v = ast.v ?? ast.value;
    if (v?.kind === "int") return [BigInt(v.value), 1n];
    if (v?.kind === "rational") return [BigInt(v.p), BigInt(v.q)];
  }
  return null;
}

function canon(ast: Ast): string {
  if (!ast || typeof ast !== "object") return "?";
  const n = numericRat(ast);
  if (n) return `n(${n[0]}/${n[1]})`;
  if (ast.t === "sym") return `s(${ast.name})`;
  if (ast.t !== "app") return "?";
  const args: Ast[] = ast.args ?? [];
  if (ast.op === "+" || ast.op === "*") {
    const parts = args.flatMap((x) => x?.t === "app" && x.op === ast.op ? (x.args ?? []) : [x]).map(canon);
    parts.sort();
    return `(${ast.op} ${parts.join(" ")})`;
  }
  if (ast.op === "-") return `(+ ${canon(args[0])} neg(${canon(args[1])}))`;
  return `(${ast.op} ${args.map(canon).join(" ")})`;
}

function isZero(ast: Ast): boolean { return canon(ast) === "n(0/1)"; }
function refId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(?:math:)?entity:(.+)$/.exec(value);
  return m ? m[1] : value || null;
}

const FUNCTION_HINT = "Keep the explicitly declared named function as a separate function entity; do not replace it with the zero-solving equation.";
const EQUATION_HINT = "Create or preserve a separate equation entity with lhs equal to the function expression and rhs equal to zero; do not replace the equation with the function entity.";
const BINDING_HINT = "The function2d.solve_equation goal must reference the separate equation entity, because the compiler requires goal.inputs[0] to be an equation.";

/** Check the v4 named-function + zero-request dual representation contract. */
export function checkFunctionZeroDuality(spec: any, statement: string): FunctionZeroDualityResult {
  if (spec?.domain !== "function2d") return { applicable: false, findings: [] };
  const goals = Array.isArray(spec.goals) ? spec.goals : [];
  const { declarations } = scanSourceMath(statement, "function2d");
  const zeroRequest = /(?:零点|零根|实数根|roots?\b|zeros?\b)/iu.test(statement);
  const declaration = declarations.find((d) => d.body && zeroRequest);
  if (!declaration) return { applicable: false, findings: [] };

  const findings: FunctionZeroDualityFinding[] = [];
  const entities = Array.isArray(spec.entities) ? spec.entities : [];
  const functionEntity = entities.find((e: any) => e?.kind === "function"
    && String(e?.label ?? e?.id ?? "") === declaration.name
    && String(e?.props?.variable ?? "") === declaration.variable
    && canon(e?.props?.expr) === canon(declaration.body));
  if (!functionEntity) findings.push({ code: "E_FUNCTION_ZERO_FUNCTION_MISSING", path: "/entities", message: "a named function declaration in a zero-finding problem must remain as a function entity", repair_hint: FUNCTION_HINT });

  const equationCandidates = entities.filter((e: any) => e?.kind === "equation"
    && e?.props?.capability_id === "function2d.solve_equation"
    && String(e?.props?.variable ?? "") === declaration.variable);
  const equationEntity = equationCandidates.find((e: any) => canon(e?.props?.lhs) === canon(declaration.body) && isZero(e?.props?.rhs));
  if (!equationEntity) {
    const matchingLhs = equationCandidates.find((e: any) => canon(e?.props?.lhs) === canon(declaration.body));
    if (matchingLhs && !isZero(matchingLhs?.props?.rhs)) findings.push({ code: "E_FUNCTION_ZERO_RHS_NOT_ZERO", path: `/entities/${matchingLhs.id}/props/rhs`, message: "the zero-solving equation must have rhs equal to zero", repair_hint: EQUATION_HINT });
    else findings.push({ code: "E_FUNCTION_ZERO_EQUATION_MISSING", path: "/entities", message: "a zero-finding request also requires a separate equation entity with function expression = 0", repair_hint: EQUATION_HINT });
  }

  const solveGoals = goals.filter((g: any) => g?.capabilityId === "function2d.solve_equation");
  const bound = solveGoals.some((g: any) => {
    const id = refId(g?.inputs?.[0]);
    return id && equationEntity?.id === id;
  });
  if (!bound) findings.push({ code: "E_FUNCTION_ZERO_GOAL_BINDING", path: "/goals", message: "the solve_equation goal must reference the separate equation entity, not the function entity", repair_hint: BINDING_HINT });

  if (functionEntity && equationEntity && canon(functionEntity.props?.expr) !== canon(equationEntity.props?.lhs)) {
    findings.push({ code: "E_FUNCTION_ZERO_EXPRESSION_MISMATCH", path: `/entities/${equationEntity.id}/props/lhs`, message: "function.expr and zero-solving equation.lhs must match after normalization", repair_hint: EQUATION_HINT });
  }
  return { applicable: true, findings };
}
