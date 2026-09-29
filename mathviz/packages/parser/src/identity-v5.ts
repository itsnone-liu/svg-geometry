// P5.4 Stage-2A/2C — named-function identity contract + goal-input
// over-reference detector. v5-only module: the v3/v4 shared verifier files are
// INTENTIONALLY UNTOUCHED (frozen blobs stay byte-identical).
//
// Stage-2A (owner ruling 2026-09-29): an explicit source declaration
// `f(x) = ...` requires the function entity to carry the canonical
// `label:"f"`; internal ids (u_func / fn_u / function_17) are NOT substitutes
// for source identity. New precise error E_FUNCTION_DECLARATION_LABEL_MISSING
// points at /entities/<id>/label and replaces the old presentation where one
// omission surfaced as a mix of four derived errors.
//
// Stage-2C: for the frozen compiler contract function2d.solve_equation the
// goal inputs must be EXACTLY [equation] — not merely inputs[0]==equation.
// New error E_FUNCTION_ZERO_GOAL_OVERREFERENCE makes the historical v4_f_05
// silent accepted drift deterministic fail-closed.
import { scanSourceMath } from "./fidelity";

type Ast = any;

export type IdentityV5Code =
  | "E_FUNCTION_DECLARATION_LABEL_MISSING"
  | "E_FUNCTION_ZERO_FUNCTION_MISSING"
  | "E_FUNCTION_ZERO_EQUATION_MISSING"
  | "E_FUNCTION_ZERO_GOAL_BINDING"
  | "E_FUNCTION_ZERO_GOAL_OVERREFERENCE"
  | "E_FUNCTION_ZERO_RHS_NOT_ZERO"
  | "E_FUNCTION_ZERO_EXPRESSION_MISMATCH";

export interface IdentityV5Finding {
  code: IdentityV5Code;
  path: string;
  message: string;
  repair_hint: string;
}

export interface IdentityV5Result {
  applicable: boolean;
  findings: IdentityV5Finding[];
  /** Stage-2A: set when a function entity matched the declaration on
   * variable+expression but lacked the canonical label. The parse-v5 pipeline
   * uses this to suppress the derived-error cascade (same root cause). */
  labelMissing: { entityId: string; declaredName: string } | null;
  /** Codes suppressed by parse-v5 while labelMissing is active (recorded, never silent). */
  suppressionCodes: string[];
  /** Resolved entities for downstream checks (repair audit, gates). */
  resolved: { functionEntity: any | null; equationEntity: any | null };
}

const LABEL_HINT = "Set this function entity's label to the explicitly declared source function name. Do not modify goal.inputs.";
const FUNCTION_HINT = "Keep the explicitly declared named function as a separate function entity with label equal to the declared name; do not replace it with the zero-solving equation.";
const EQUATION_HINT = "Create or preserve a separate equation entity with lhs equal to the function expression and rhs equal to zero; do not replace the equation with the function entity.";
const BINDING_HINT = "The function2d.solve_equation goal must reference the separate equation entity, because the compiler requires goal.inputs[0] to be an equation.";
const OVERREF_HINT = "The function2d.solve_equation goal must take EXACTLY one input: the separate equation entity. Remove every additional input reference.";

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

/** Stage-2A/2C identity + duality check for the v5 pipeline. */
export function checkIdentityV5(spec: any, statement: string): IdentityV5Result {
  if (spec?.domain !== "function2d") return { applicable: false, findings: [], labelMissing: null, suppressionCodes: [], resolved: { functionEntity: null, equationEntity: null } };
  const goals = Array.isArray(spec.goals) ? spec.goals : [];
  const { declarations } = scanSourceMath(statement, "function2d");
  const zeroRequest = /(?:零点|零根|实数根|roots?\b|zeros?\b)/iu.test(statement);
  const declaration = declarations.find((d) => d.body && zeroRequest);
  if (!declaration) return { applicable: false, findings: [], labelMissing: null, suppressionCodes: [], resolved: { functionEntity: null, equationEntity: null } };

  const findings: IdentityV5Finding[] = [];
  const entities = Array.isArray(spec.entities) ? spec.entities : [];
  const isFunctionShape = (e: any) => e?.kind === "function"
    && String(e?.props?.variable ?? "") === declaration.variable
    && canon(e?.props?.expr) === canon(declaration.body);

  // Stage-2A: strict source-identity match (label MUST equal the declared name).
  const strictMatch = entities.find((e: any) => isFunctionShape(e) && e?.label === declaration.name);
  const unlabeledMatch = strictMatch ? undefined : entities.find((e: any) => isFunctionShape(e) && e?.label !== declaration.name);
  let labelMissing: IdentityV5Result["labelMissing"] = null;
  let functionEntity: any = strictMatch ?? null;
  if (!strictMatch && unlabeledMatch) {
    labelMissing = { entityId: unlabeledMatch.id, declaredName: declaration.name };
    findings.push({
      code: "E_FUNCTION_DECLARATION_LABEL_MISSING",
      path: `/entities/${unlabeledMatch.id}/label`,
      message: `function entity '${unlabeledMatch.id}' matches the declared variable and expression but does not carry the canonical declared function name label:"${declaration.name}"; entity id is not a substitute for the declared function name`,
      repair_hint: LABEL_HINT,
    });
  } else if (!strictMatch) {
    findings.push({ code: "E_FUNCTION_ZERO_FUNCTION_MISSING", path: "/entities", message: "a named function declaration in a zero-finding problem must remain as a function entity", repair_hint: FUNCTION_HINT });
  }

  const equationCandidates = entities.filter((e: any) => e?.kind === "equation"
    && e?.props?.capability_id === "function2d.solve_equation"
    && String(e?.props?.variable ?? "") === declaration.variable);
  const equationEntity = equationCandidates.find((e: any) => canon(e?.props?.lhs) === canon(declaration.body) && isZero(e?.props?.rhs)) ?? null;
  if (!equationEntity) {
    const matchingLhs = equationCandidates.find((e: any) => canon(e?.props?.lhs) === canon(declaration.body));
    if (matchingLhs && !isZero(matchingLhs?.props?.rhs)) findings.push({ code: "E_FUNCTION_ZERO_RHS_NOT_ZERO", path: `/entities/${matchingLhs.id}/props/rhs`, message: "the zero-solving equation must have rhs equal to zero", repair_hint: EQUATION_HINT });
    else findings.push({ code: "E_FUNCTION_ZERO_EQUATION_MISSING", path: "/entities", message: "a zero-finding request also requires a separate equation entity with function expression = 0", repair_hint: EQUATION_HINT });
  }

  // Stage-2C: goal inputs must be EXACTLY [equation] — fail-closed on any
  // over-reference ([equation, function], [function, equation],
  // [equation, equation2], [equation, arbitrary_entity], ...).
  const solveGoals = goals.filter((g: any) => g?.capabilityId === "function2d.solve_equation");
  for (const g of solveGoals) {
    const inputs: string[] = Array.isArray(g?.inputs) ? g.inputs : [];
    const ids = inputs.map(refId);
    const boundToEquation = equationEntity ? ids.filter((x) => x === equationEntity.id).length : 0;
    if (inputs.length === 1 && boundToEquation === 1) continue; // exactly [equation]: OK
    if (boundToEquation >= 1) {
      findings.push({
        code: "E_FUNCTION_ZERO_GOAL_OVERREFERENCE",
        path: `/goals/${g.goalId}/inputs`,
        message: `the solve_equation goal must take exactly one input (the separate equation entity); got ${JSON.stringify(inputs)}`,
        repair_hint: OVERREF_HINT,
      });
    } else {
      findings.push({
        code: "E_FUNCTION_ZERO_GOAL_BINDING",
        path: `/goals/${g.goalId}/inputs`,
        message: "the solve_equation goal must reference the separate equation entity, not the function entity",
        repair_hint: BINDING_HINT,
      });
    }
  }

  const fnForExprCheck = strictMatch ?? unlabeledMatch;
  if (fnForExprCheck && equationEntity && canon(fnForExprCheck.props?.expr) !== canon(equationEntity.props?.lhs)) {
    findings.push({ code: "E_FUNCTION_ZERO_EXPRESSION_MISMATCH", path: `/entities/${equationEntity.id}/props/lhs`, message: "function.expr and zero-solving equation.lhs must match after normalization", repair_hint: EQUATION_HINT });
  }

  return {
    applicable: true, findings, labelMissing,
    // Derived-error suppression set (same root cause as the missing label);
    // the parse-v5 pipeline reports the suppression count, never silently.
    suppressionCodes: ["E_SOURCE_COMPLETENESS", "E_SOURCE_IRRELEVANT", "E_FUNCTION_ZERO_FUNCTION_MISSING"],
    resolved: { functionEntity, equationEntity },
  };
}
