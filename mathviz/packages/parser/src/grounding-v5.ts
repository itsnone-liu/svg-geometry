// P5.4 Stage-2D — G19 function-zero special-case bugfix (correctness debt;
// NOT the root cause of the v4 live regressions, which Stage-1.1 pinned on
// label omission + non-monotonic repair).
//
// The frozen grounding.ts contains a function-anchor special case whose
// arguments are REVERSED (`functionDeclaration(f.label ?? nameOf(f), span)`)
// and which hardcodes quadratic-specific substring evidence ("^2", "x^2").
// That shared file is FROZEN and stays byte-identical; this v5 wrapper re-runs
// ONLY the function-entity anchor verdict with corrected evidence:
//   - argument order fixed (slice first, declared label second);
//   - substring heuristics replaced by canonical AST power-form evidence and
//     the actual declared variable/zero-request semantics;
//   - exact-source-slice strictness is NOT relaxed in any way (the shared
//     slice-integrity checks run untouched and are never overridden here).
import { groundProblemSpec } from "./grounding";

type Ast = any;

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

function isZeroAst(ast: Ast): boolean { return canon(ast) === "n(0/1)"; }

/** AST power-form evidence (replaces hardcoded "^2"/"x^2" substring checks). */
function hasOp(ast: Ast, op: string): boolean {
  if (!ast || typeof ast !== "object") return false;
  if (ast.t === "app") {
    if (ast.op === op) return true;
    return (ast.args ?? []).some((a: Ast) => hasOp(a, op));
  }
  return false;
}

function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Corrected declared-function-anchor predicate: the cited slice must open a
 * call form of the DECLARED name and carry an equality sign. */
function declaredFunctionAnchor(slice: string, label: string): boolean {
  if (!slice || !label) return false;
  return new RegExp(`${esc(label)}\\s*\\(`).test(slice) && /[=＝]/u.test(slice);
}

/** v5 grounding: shared verdicts, with only the function-entity anchor
 * re-adjudicated under the corrected special case. */
export function groundProblemSpecV5(spec: any, statement: string) {
  const base = groundProblemSpec(spec, statement);
  const anchorAbsent = base.findings.some((f: any) => f.grounded === false && f.reason === "function name/equality anchor absent");
  if (!anchorAbsent) return base;

  const entities: any[] = Array.isArray(spec?.entities) ? spec.entities : [];
  const zeroRequest = /(?:零点|零根|实数根|roots?\b|zeros?\b)/iu.test(statement);
  let correctedCount = 0;
  const findings = base.findings.map((f: any) => {
    if (f.grounded !== false || f.reason !== "function name/equality anchor absent") return f;
    const m = /^\/entities\/([^/]+)$/.exec(String(f.path ?? ""));
    const e = entities.find((x) => x?.id === (m ? m[1] : ""));
    if (!e || e.kind !== "function") return f;
    // Corrected special case (Stage-2D): accept the function anchor when the
    // zero-request is present, the span is a valid exact slice whose text
    // anchors the declared name + equality, the expression is power-form AST
    // evidence, and a matching zero-equation (expr === lhs, rhs = 0) exists.
    const s = e?.provenance?.span;
    const slice = spec?.statement === statement && Number.isInteger(s?.start) && Number.isInteger(s?.end) && s.end > s.start && s.end <= statement.length && statement.slice(s.start, s.end) === s.text ? s.text : null;
    if (slice === null) return f; // exact-source-slice strictness preserved
    const label = typeof e?.label === "string" && e.label ? e.label : (typeof e?.id === "string" ? e.id : "");
    const zeroEq = entities.find((x: any) => x?.kind === "equation"
      && x?.props?.capability_id === "function2d.solve_equation"
      && canon(x?.props?.lhs) === canon(e?.props?.expr)
      && isZeroAst(x?.props?.rhs));
    if (zeroRequest && zeroEq && hasOp(e?.props?.expr, "^") && declaredFunctionAnchor(slice, label)) {
      correctedCount++;
      return { ...f, grounded: true, reason: "function anchor accepted via matching zero-equation and declared-name anchor (P5.4 Stage-2D corrected special case)" };
    }
    return f;
  });
  const semanticGroundedCount = findings.filter((f: any) => f.grounded === true).length;
  return {
    ...base,
    semanticGroundedCount,
    semanticGrounded: semanticGroundedCount === base.semanticTotal,
    findings,
    p54_stage2d_corrections: correctedCount,
  };
}
