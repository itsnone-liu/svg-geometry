// Symbolic differentiation over the FROZEN ExprAst vocabulary (P4 §16).
// Implemented for: + - * / ^ (integer constant exponent) neg sin cos tan
// exp ln sqrt, constants and symbols. Anything else — notably f(x)^g(x)
// with a non-constant exponent, abs — is E_CAPABILITY_UNSUPPORTED: we never
// silently substitute numeric differencing for a mathematical fact.
//
// The derivative is built as plain ExprAst (int literals), evaluated later by
// the SAME runtime ExprAst evaluator the browser uses.

import { makeRuntimeError } from "../../../runtime/src/errors";
import type { ExprAst } from "../../../runtime/src/expr/evaluate";

const DIFF_OPS = new Set(["+", "-", "*", "/", "^", "neg", "sin", "cos", "tan", "exp", "ln", "sqrt"]);

function int(n: number | string): ExprAst {
  return { t: "num", v: { kind: "int", value: String(n) } };
}
function sym(name: string): ExprAst {
  return { t: "sym", name };
}
function app(op: string, ...args: ExprAst[]): ExprAst {
  return { t: "app", op, args };
}

function isIntLiteral(ast: ExprAst, value?: number): boolean {
  if (!ast || ast.t !== "num") return false;
  const v = ast.v;
  if (!v || v.kind !== "int" || typeof v.value !== "string") return false;
  if (!/^-?(0|[1-9][0-9]*)$/.test(v.value)) return false;
  return value === undefined || Number(v.value) === value;
}

/** d/d(variable) ast — throws VizRuntimeError on unsupported shapes. */
export function differentiate(ast: ExprAst, variable: string): ExprAst {
  if (!ast || typeof ast !== "object" || typeof ast.t !== "string") {
    throw makeRuntimeError("E_SCHEMA", "differentiate: expression node must be an object");
  }
  switch (ast.t) {
    case "num": {
      const v = (ast as any).v;
      if (v && v.kind === "symbolic") return differentiate(v.expr, variable);
      return int(0);
    }
    case "sym": {
      const name = (ast as any).name;
      if (typeof name !== "string") throw makeRuntimeError("E_SCHEMA", "differentiate: sym needs a name");
      return name === variable ? int(1) : int(0);
    }
    case "app": {
      const op = (ast as any).op;
      const args: ExprAst[] = Array.isArray((ast as any).args) ? (ast as any).args : [];
      if (!DIFF_OPS.has(op)) {
        throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `differentiate: operator '${op}' has no symbolic derivative rule`);
      }
      switch (op) {
        case "+":
        case "-": {
          if (args.length !== 2) throw makeRuntimeError("E_SCHEMA", `differentiate: '${op}' needs 2 args`);
          return app(op, differentiate(args[0], variable), differentiate(args[1], variable));
        }
        case "neg": {
          if (args.length !== 1) throw makeRuntimeError("E_SCHEMA", "differentiate: neg needs 1 arg");
          return app("neg", differentiate(args[0], variable));
        }
        case "*": {
          if (args.length !== 2) throw makeRuntimeError("E_SCHEMA", "differentiate: '*' needs 2 args");
          const [a, b] = args;
          return app("+",
            app("*", differentiate(a, variable), b),
            app("*", a, differentiate(b, variable)));
        }
        case "/": {
          if (args.length !== 2) throw makeRuntimeError("E_SCHEMA", "differentiate: '/' needs 2 args");
          const [a, b] = args;
          return app("/",
            app("-",
              app("*", differentiate(a, variable), b),
              app("*", a, differentiate(b, variable))),
            app("^", b, int(2)));
        }
        case "^": {
          if (args.length !== 2) throw makeRuntimeError("E_SCHEMA", "differentiate: '^' needs 2 args");
          const [base, exponent] = args;
          // P4 restriction: integer CONSTANT exponent only (frozen vocabulary
          // allows the general form; the derivative does not, on purpose).
          if (!isIntLiteral(exponent)) {
            throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", "differentiate: only integer constant exponents are supported in P4 (f(x)^g(x) rejected)");
          }
          const n = Number((exponent as any).v.value);
          if (n === 0) return int(0);
          // d/dx base^n = n * base^(n-1) * base'
          const power = app("^", base, int(n - 1));
          return app("*", int(n), app("*", power, differentiate(base, variable)));
        }
        case "sin": {
          if (args.length !== 1) throw makeRuntimeError("E_SCHEMA", "differentiate: sin needs 1 arg");
          return app("*", app("cos", args[0]), differentiate(args[0], variable));
        }
        case "cos": {
          if (args.length !== 1) throw makeRuntimeError("E_SCHEMA", "differentiate: cos needs 1 arg");
          return app("*", app("neg", app("sin", args[0])), differentiate(args[0], variable));
        }
        case "tan": {
          if (args.length !== 1) throw makeRuntimeError("E_SCHEMA", "differentiate: tan needs 1 arg");
          return app("/",
            differentiate(args[0], variable),
            app("^", app("cos", args[0]), int(2)));
        }
        case "exp": {
          if (args.length !== 1) throw makeRuntimeError("E_SCHEMA", "differentiate: exp needs 1 arg");
          return app("*", app("exp", args[0]), differentiate(args[0], variable));
        }
        case "ln": {
          if (args.length !== 1) throw makeRuntimeError("E_SCHEMA", "differentiate: ln needs 1 arg");
          return app("/", differentiate(args[0], variable), args[0]);
        }
        case "sqrt": {
          if (args.length !== 1) throw makeRuntimeError("E_SCHEMA", "differentiate: sqrt needs 1 arg");
          return app("/",
            differentiate(args[0], variable),
            app("*", int(2), app("sqrt", args[0])));
        }
        default:
          throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `differentiate: '${op}' unsupported`);
      }
    }
    default:
      throw makeRuntimeError("E_SCHEMA", `differentiate: unknown node tag '${(ast as any).t}'`);
  }
}

/** Structural pre-check used at compile: reject programs whose derivative is
 *  known-unsupported (non-integer-constant '^' exponents anywhere, abs). */
export function assertDifferentiable(ast: ExprAst, where: string): void {
  if (!ast || typeof ast !== "object") return;
  if (ast.t === "num") {
    const v = (ast as any).v;
    if (v && v.kind === "symbolic") assertDifferentiable(v.expr, where);
    return;
  }
  if (ast.t === "sym") return;
  if (ast.t !== "app") return;
  const op = (ast as any).op;
  const args: ExprAst[] = Array.isArray((ast as any).args) ? (ast as any).args : [];
  if (op === "abs") {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `${where}: abs() has no symbolic derivative rule in P4`);
  }
  if (op === "^" && args.length === 2 && !isIntLiteral(args[1])) {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `${where}: '^' requires an integer constant exponent in P4`);
  }
  for (const a of args) assertDifferentiable(a, where);
}
