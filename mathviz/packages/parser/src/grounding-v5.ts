// P5.4 Stage-2D / Stage-3.1 — G19 function-zero special-case bugfix
// (correctness debt; NOT the root cause of the v4 live regressions, which
// Stage-1.1 pinned on label omission + non-monotonic repair).
//
// The frozen grounding.ts semantic loop contains a quadratic zero-request
// special case that overrules an equation entity's expressionGrounded
// verdict. In the frozen file that special case is DEAD CODE for two reasons:
//   (a) functionDeclaration() is called with REVERSED arguments
//       (`functionDeclaration(f.label ?? nameOf(f), f.provenance.span.text)`)
//       so the predicate almost always evaluates false;
//   (b) its evidence predicates are quadratic-specific substring checks
//       (`span.text.includes("^2")`, `s.text.includes("x^2")`) that assume
//       variable "x".
// The shared file is FROZEN and stays byte-identical. This v5 wrapper re-runs
// ONLY the equation-entity semantic verdict under the corrected evidence:
//   - argument order fixed (declared-name anchor over the function's own
//     exact span, which must contain `name(` and `=`);
//   - substring heuristics replaced by canonical-AST power-form evidence
//     (any `^` node in the declared expression) — works for h(y)=y^3-…, not
//     just quadratics in x;
//   - equation.props.variable MUST equal function.props.variable
//     (Stage-3.1: the "actual declared variable" claim is now enforced);
//   - canonical AST equivalence lhs === function.expr and rhs === 0;
//   - the equation's cited slice must be a valid exact slice that contains
//     the function's declaration span text and a zero-request term.
// Exact-source-slice strictness is NOT relaxed: slice validity comes from the
// shared checker's own span validation, and only the semantic verdict of the
// equation entity is re-adjudicated.
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

/** Corrected declared-function anchor: the function's own exact span must
 * open a call form of the DECLARED name and carry an equality sign. */
function declaredFunctionAnchor(slice: string, label: string): boolean {
  if (!slice || !label) return false;
  return new RegExp(`${esc(label)}\\s*\\(`).test(slice) && /=/u.test(slice);
}

const ZERO_REQUEST = /(?:零点|零根|实数根|roots?\b|zeros?\b)/iu;

/** v5 grounding: shared verdicts, with only the equation-entity semantic
 * verdict re-adjudicated under the corrected Stage-2D special case. */
export function groundProblemSpecV5(spec: any, statement: string) {
  const base = groundProblemSpec(spec, statement);
  const rejectedEquations = base.findings.filter((f: any) => f.grounded === false && /^\/entities\/[^/]+$/.test(String(f.path ?? "")));
  if (!rejectedEquations.length) return base;

  const entities: any[] = Array.isArray(spec?.entities) ? spec.entities : [];
  let correctedCount = 0;
  const findings = base.findings.map((f: any) => {
    if (f.grounded !== false) return f;
    const m = /^\/entities\/([^/]+)$/.exec(String(f.path ?? ""));
    if (!m) return f;
    const eq = entities.find((x) => x?.id === m[1]);
    if (!eq || eq.kind !== "equation") return f;

    // the equation's cited slice must be a VALID exact slice
    const s = eq?.provenance?.span;
    const slice = spec?.statement === statement && Number.isInteger(s?.start) && Number.isInteger(s?.end) && s.end > s.start && s.end <= statement.length && statement.slice(s.start, s.end) === s.text ? s.text : null;
    if (slice === null) return f; // exact-source-slice strictness preserved
    if (!ZERO_REQUEST.test(slice) || !(eq?.props?.rhs?.t === "num" && isZeroAst(eq.props.rhs))) return f;

    const fn = entities.find((x: any) => {
      if (x?.kind !== "function") return false;
      const fs = x?.provenance?.span;
      const fnSlice = Number.isInteger(fs?.start) && Number.isInteger(fs?.end) && fs.end > fs.start && fs.end <= statement.length && statement.slice(fs.start, fs.end) === fs.text ? fs.text : null;
      if (fnSlice === null) return false;
      // declared identity + canonical AST equivalence + ACTUAL DECLARED
      // VARIABLE equality (Stage-3.1) + slice coverage of the declaration
      return String(x?.props?.variable ?? "") === String(eq?.props?.variable ?? "")
        && canon(x?.props?.expr) === canon(eq?.props?.lhs)
        && declaredFunctionAnchor(fnSlice, typeof x?.label === "string" && x.label ? x.label : (typeof x?.id === "string" ? x.id : ""))
        && slice.includes(fnSlice);
    });
    if (fn && hasOp(fn.props?.expr, "^")) {
      correctedCount++;
      return { ...f, grounded: true, reason: "declared function expression matches equation and explicit zero-set request (P5.4 Stage-2D corrected special case)" };
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
