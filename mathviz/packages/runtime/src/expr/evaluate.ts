// Expression evaluator over the frozen ExprAst vocabulary ONLY:
// + - * / ^ neg sin cos tan asin acos atan exp ln sqrt abs
// Rules (frozen P1 semantics):
//   - int/rational operands stay exact (bigint rationals) wherever possible
//   - transcendentals and float operands go to deterministic numeric evaluation
//   - missing symbol            -> E_BINDING
//   - division by zero, sqrt(neg), ln(non-positive), asin/acos outside [-1,1]
//                               -> E_MATH_CONSTRAINT
// No eval(), no Function(), no Math.random, no clock reads.

import { makeRuntimeError } from "../errors";
import { Rat, ratAdd, ratDiv, ratMul, ratNeg, ratPow, ratSub, ratToNumber } from "./exact";

export type Value =
  | { kind: "exact"; r: Rat }
  | { kind: "num"; v: number };

export type Env = Record<string, Value>;

export type ExprAst = any; // structural checks below; schema-validated upstream

const SYMBOLIC_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E
};

function isExact(v: Value): v is { kind: "exact"; r: Rat } {
  return v.kind === "exact";
}

function asNumber(v: Value): number {
  return isExact(v) ? ratToNumber(v.r) : v.v;
}

function numError(msg: string): never {
  throw makeRuntimeError("E_MATH_CONSTRAINT", msg);
}

function numericBinop(op: string, a: number, b: number): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/":
      if (b === 0) numError(`division by zero (${a} / 0)`);
      return a / b;
    case "^": return a ** b;
    default: throw makeRuntimeError("E_SCHEMA", `unknown operator '${op}'`);
  }
}

export function evalExpr(ast: ExprAst, env: Env): Value {
  if (!ast || typeof ast !== "object" || typeof ast.t !== "string") {
    throw makeRuntimeError("E_SCHEMA", "expression node must be an object with a 't' tag");
  }
  switch (ast.t) {
    case "num": {
      const v = ast.v;
      if (!v || typeof v !== "object") throw makeRuntimeError("E_SCHEMA", "num node needs a value object");
      if (v.kind === "int" && typeof v.value === "string") {
        if (!/^-?(0|[1-9][0-9]*)$/.test(v.value)) throw makeRuntimeError("E_SCHEMA", `malformed int literal '${v.value}'`);
        return { kind: "exact", r: { p: BigInt(v.value), q: 1n } };
      }
      if (v.kind === "rational" && typeof v.p === "string" && typeof v.q === "string") {
        if (!/^-?(0|[1-9][0-9]*)$/.test(v.p) || !/^[1-9][0-9]*$/.test(v.q)) {
          throw makeRuntimeError("E_SCHEMA", `malformed rational literal '${v.p}/${v.q}'`);
        }
        return { kind: "exact", r: { p: BigInt(v.p), q: BigInt(v.q) } };
      }
      if (v.kind === "symbolic" && typeof v.expr === "object") {
        // evaluate symbolic constants (pi etc.) deterministically; anything
        // else must resolve through the environment as a plain symbol
        return evalExpr(v.expr, env);
      }
      throw makeRuntimeError("E_SCHEMA", "unsupported exact number form");
    }
    case "sym": {
      const name = ast.name;
      if (typeof name !== "string" || name.length === 0) throw makeRuntimeError("E_SCHEMA", "sym node needs a name");
      if (Object.prototype.hasOwnProperty.call(env, name)) return env[name];
      if (Object.prototype.hasOwnProperty.call(SYMBOLIC_CONSTANTS, name)) {
        return { kind: "num", v: SYMBOLIC_CONSTANTS[name] };
      }
      throw makeRuntimeError("E_BINDING", `unknown symbol '${name}'`);
    }
    case "app": {
      const op = ast.op;
      const args: ExprAst[] = Array.isArray(ast.args) ? ast.args : [];
      const vals = args.map(a => evalExpr(a, env));
      if (op === "neg") {
        if (vals.length !== 1) throw makeRuntimeError("E_SCHEMA", "neg takes exactly 1 argument");
        return isExact(vals[0]) ? { kind: "exact", r: ratNeg(vals[0].r) } : { kind: "num", v: -vals[0].v };
      }
      if (op === "abs") {
        if (vals.length !== 1) throw makeRuntimeError("E_SCHEMA", "abs takes exactly 1 argument");
        if (isExact(vals[0])) {
          const r = vals[0].r;
          return { kind: "exact", r: r.p < 0n ? ratNeg(r) : r };
        }
        return { kind: "num", v: Math.abs(vals[0].v) };
      }
      // binary arithmetic
      if (op === "+" || op === "-" || op === "*" || op === "/" || op === "^") {
        if (vals.length !== 2) throw makeRuntimeError("E_SCHEMA", `operator '${op}' takes exactly 2 arguments`);
        const [a, b] = vals;
        if (op === "^" && isExact(a) && isExact(b) && b.r.q === 1n) {
          try {
            return { kind: "exact", r: ratPow(a.r, b.r.p) };
          } catch (err: any) {
            numError(err?.message ?? "integer power failed");
          }
        }
        if (isExact(a) && isExact(b)) {
          switch (op) {
            case "+": return { kind: "exact", r: ratAdd(a.r, b.r) };
            case "-": return { kind: "exact", r: ratSub(a.r, b.r) };
            case "*": return { kind: "exact", r: ratMul(a.r, b.r) };
            case "/":
              if (b.r.p === 0n) numError("division by zero (exact)");
              return { kind: "exact", r: ratDiv(a.r, b.r) };
          }
        }
        return { kind: "num", v: numericBinop(op, asNumber(a), asNumber(b)) };
      }
      // transcendentals — always deterministic numeric
      if (vals.length !== 1) throw makeRuntimeError("E_SCHEMA", `function '${op}' takes exactly 1 argument`);
      const x = asNumber(vals[0]);
      switch (op) {
        case "sin": return { kind: "num", v: Math.sin(x) };
        case "cos": return { kind: "num", v: Math.cos(x) };
        case "tan": return { kind: "num", v: Math.tan(x) };
        case "asin":
          if (x < -1 || x > 1) numError(`asin outside [-1,1]: ${x}`);
          return { kind: "num", v: Math.asin(x) };
        case "acos":
          if (x < -1 || x > 1) numError(`acos outside [-1,1]: ${x}`);
          return { kind: "num", v: Math.acos(x) };
        case "atan": return { kind: "num", v: Math.atan(x) };
        case "exp": return { kind: "num", v: Math.exp(x) };
        case "ln":
          if (x <= 0) numError(`ln of non-positive: ${x}`);
          return { kind: "num", v: Math.log(x) };
        case "sqrt":
          if (x < 0) numError(`sqrt of negative: ${x}`);
          return { kind: "num", v: Math.sqrt(x) };
        default:
          throw makeRuntimeError("E_SCHEMA", `operator not in frozen vocabulary: '${op}'`);
      }
    }
    default:
      throw makeRuntimeError("E_SCHEMA", `unknown expression tag '${ast.t}'`);
  }
}

export function valueToNumber(v: Value): number {
  return asNumber(v);
}
