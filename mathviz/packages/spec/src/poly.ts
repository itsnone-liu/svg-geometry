// Function2D goal solver for the ProblemSpec deterministic compiler (P5.0).
//
// Solves `lhs = rhs` over the reals with EXACT bigint rational arithmetic —
// this is the PRODUCTION solver path, deliberately independent of SymPy
// (SymPy stays the P4 freeze oracle; making it the production solver would
// let the system verify its own homework).
//
// Honest capability boundary (fail-closed, mirrors P4.1):
//   - the equation must reduce to a POLYNOMIAL in the variable with rational
//     coefficients, built from + - * / ^ over int/rational literals
//   - free parameter symbols are REFUSED (they need the future
//     ConditionalSolutionSet contract, exactly like SymPy ConditionSet)
//   - degree is capped (<= 8) as a complexity guard
//   - after extracting ALL rational roots, the residual polynomial must be a
//     constant: otherwise non-rational roots may exist and we cannot certify
//     completeness -> E_CAPABILITY_UNSUPPORTED (e.g. x^2-2=0 is refused even
//     though SymPy can solve it; production honesty > coverage)
//
// Completeness certificate: rational-root theorem + exact division. Every
// accepted root is additionally re-verified by substitution through the
// runtime expression evaluator (independent code path).

import { makeRuntimeError } from "../../runtime/src/errors";
import { rat, ratAdd, ratDiv, ratMul, type Rat } from "../../runtime/src/expr/exact";

const MAX_DEGREE = 8;

/** bigint gcd */
function bgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a, y = b < 0n ? -b : b;
  while (y) { const t = x % y; x = y; y = t; }
  return x;
}

/** integer sqrt floor */
function bisqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("neg");
  if (n < 2n) return n;
  let lo = 1n, hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid * mid <= n) lo = mid; else hi = mid - 1n;
  }
  return lo;
}

// ---- polynomial extraction over ExprAst ----

const zero: Rat[] = [rat(0n)];

function padAdd(a: Rat[], b: Rat[]): Rat[] {
  const n = Math.max(a.length, b.length);
  const out: Rat[] = [];
  for (let i = 0; i < n; i++) out.push(ratAdd(a[i] ?? rat(0n), b[i] ?? rat(0n)));
  return out;
}

function scale(a: Rat[], k: Rat): Rat[] {
  return a.map((c) => ratMul(c, k));
}

function polyMul(a: Rat[], b: Rat[]): Rat[] {
  const out: Rat[] = new Array(a.length + b.length - 1).fill(rat(0n));
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] = ratAdd(out[i + j]!, ratMul(a[i]!, b[j]!));
    }
  }
  return out;
}

function numToRat(v: any): Rat {
  if (!v || typeof v !== "object") throw makeRuntimeError("E_SCHEMA", "num node needs a value object");
  if (v.kind === "int" && typeof v.value === "string") return rat(BigInt(v.value));
  if (v.kind === "rational" && typeof v.p === "string" && typeof v.q === "string") return rat(BigInt(v.p), BigInt(v.q));
  throw makeRuntimeError("E_SCHEMA", `unsupported numeric literal kind '${String(v.kind)}'`);
}

/** Extract polynomial coefficients (index = power, coeffs[0] = constant). */
export function extractPolynomial(ast: any, variable: string): Rat[] {
  if (!ast || typeof ast !== "object" || typeof ast.t !== "string") {
    throw makeRuntimeError("E_SCHEMA", "expression node must be an object with a 't' tag");
  }
  if (ast.t === "num") return [numToRat(ast.v)];
  if (ast.t === "sym") {
    if (ast.name !== variable) {
      throw makeRuntimeError(
        "E_CAPABILITY_UNSUPPORTED",
        `free symbol '${String(ast.name)}' in equation: parameterized solutions need the ConditionalSolutionSet contract (refused)`
      );
    }
    return [rat(0n), rat(1n)];
  }
  if (ast.t === "app") {
    const op = ast.op;
    const args: any[] = Array.isArray(ast.args) ? ast.args : [];
    switch (op) {
      case "+":
        return args.reduce<Rat[]>((acc, a) => padAdd(acc, extractPolynomial(a, variable)), zero.slice());
      case "-":
        if (args.length === 1) return scale(extractPolynomial(args[0], variable), rat(-1n));
        return args.slice(1).reduce<Rat[]>(
          (acc, a) => padAdd(acc, scale(extractPolynomial(a, variable), rat(-1n))),
          extractPolynomial(args[0], variable)
        );
      case "*":
        return args.reduce<Rat[]>((acc, a) => polyMul(acc, extractPolynomial(a, variable)), [rat(1n)]);
      case "/": {
        if (args.length !== 2) throw makeRuntimeError("E_SCHEMA", "'/' needs exactly two operands");
        const den = extractPolynomial(args[1], variable);
        if (den.length !== 1 || den[0]!.p === 0n) {
          throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", "division by a non-constant polynomial is outside the rational-root solver");
        }
        return scale(extractPolynomial(args[0], variable), ratDiv(rat(1n), den[0]!));
      }
      case "neg":
        return scale(extractPolynomial(args[0], variable), rat(-1n));
      case "^": {
        if (args.length !== 2) throw makeRuntimeError("E_SCHEMA", "'^' needs exactly two operands");
        const exponent = args[1];
        if (exponent?.t !== "num" || exponent.v?.kind !== "int") {
          throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", "variable or non-integer exponents are outside the rational-root solver");
        }
        const e = BigInt(exponent.v.value);
        if (e < 0n || e > BigInt(MAX_DEGREE)) {
          throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `exponent ${e} outside degree cap ${MAX_DEGREE}`);
        }
        const base = extractPolynomial(args[0], variable);
        let out: Rat[] = [rat(1n)];
        for (let i = 0; i < Number(e); i++) out = polyMul(out, base);
        return out;
      }
      default:
        throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `operator '${String(op)}' is outside the rational-root solver vocabulary`);
    }
  }
  throw makeRuntimeError("E_SCHEMA", `unknown expression node '${String(ast.t)}'`);
}

function evalPoly(coeffs: Rat[], x: Rat): Rat {
  let acc = rat(0n);
  for (let i = coeffs.length - 1; i >= 0; i--) acc = ratAdd(ratMul(acc, x), coeffs[i]!);
  return acc;
}

/** Exact synthetic division of monic factor (x - root); returns null if not divisible. */
function deflate(coeffs: Rat[], root: Rat): Rat[] | null {
  // divide coeffs (high->low) by (x - root): synthetic division
  const hi = [...coeffs].reverse(); // high degree first
  if (hi.length < 2) return null;
  const out: Rat[] = [hi[0]!];
  for (let i = 1; i < hi.length - 1; i++) {
    out.push(ratAdd(hi[i]!, ratMul(out[out.length - 1]!, root)));
  }
  const remainder = ratAdd(hi[hi.length - 1]!, ratMul(out[out.length - 1]!, root));
  if (remainder.p !== 0n) return null;
  return out.reverse(); // back to low->high (leading zeros possible)
}

function trimLeading(p: Rat[]): Rat[] {
  let n = p.length;
  while (n > 1 && p[n - 1]!.p === 0n) n--;
  return p.slice(0, n);
}

function divisorsOf(n: bigint): bigint[] {
  const N = n < 0n ? -n : n;
  const out: bigint[] = [1n];
  for (let d = 2n; d * d <= N; d++) {
    if (N % d === 0n) {
      out.push(d);
      if (d * d !== N) out.push(N / d);
    }
  }
  if (N !== 1n) out.push(N);
  return out;
}

/**
 * Rational roots of a rational-coefficient polynomial, as a SET, with a
 * completeness certificate: every root found is divided out exactly; if the
 * residual is non-constant, other (irrational/complex) roots may exist and
 * the solve is refused. Throws E_CAPABILITY_UNSUPPORTED on any doubt.
 */
export function rationalRoots(coeffsIn: Rat[]): Rat[] {
  let coeffs = trimLeading(coeffsIn.map((c) => ({ ...c })));
  if (coeffs.length === 1) {
    if (coeffs[0]!.p === 0n) throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", "equation reduces to 0 = 0 (identically true)");
    return []; // no roots
  }
  if (coeffs.length - 1 > MAX_DEGREE) {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `degree ${coeffs.length - 1} exceeds cap ${MAX_DEGREE}`);
  }
  // scale to integer coefficients (for divisor enumeration only): the
  // leading/trailing integer numerators under the common denominator lcm
  let lcm = 1n;
  for (const c of coeffs) lcm = (lcm * c.q) / bgcd(lcm, c.q);
  const intNumerator = (c: Rat): bigint => (c.p * lcm) / c.q;
  let residual: Rat[] = coeffs;
  const a0 = intNumerator(coeffs[0]!);
  const an = intNumerator(coeffs[coeffs.length - 1]!);
  const roots = new Set<string>();
  const pDivs = a0 === 0n ? [0n] : divisorsOf(a0);
  const qDivs = divisorsOf(an);

  const candidates: Rat[] = [];
  const seen = new Set<string>();
  for (const p of pDivs) {
    for (const q of qDivs) {
      for (const sp of (p === 0n ? [1n] : [1n, -1n])) {
        const num = p * sp;
        const g = bgcd(num, q) || 1n;
        const key = `${num / g}/${q / g}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(rat(num / g, q / g));
        }
      }
    }
  }
  // deterministic candidate order: by numeric value
  candidates.sort((a, b) => Number(a.p) / Number(a.q) - Number(b.p) / Number(b.q));

  let changed = true;
  while (changed) {
    changed = false;
    for (const cand of candidates) {
      const deflated = deflate(residual, cand);
      if (deflated) {
        roots.add(`${cand.p}/${cand.q}`);
        residual = trimLeading(deflated);
        changed = true;
        if (residual.length === 1) break;
      }
    }
  }
  residual = trimLeading(residual);
  // completeness certificate: after dividing out every rational root the
  // residual must be a NON-ZERO CONSTANT (degree 0). A degree >= 1 residual
  // may own non-rational real roots -> refuse rather than under-report.
  if (residual.length > 1) {
    throw makeRuntimeError(
      "E_CAPABILITY_UNSUPPORTED",
      "cannot certify the real solution set: non-rational roots may exist after extracting all rational roots (rational-root certificate incomplete)"
    );
  }
  const out = [...roots].map((k) => {
    const [p, q] = k.split("/");
    return rat(BigInt(p), BigInt(q));
  });
  out.sort((a, b) => Number(a.p) / Number(a.q) - Number(b.p) / Number(b.q));
  // final exact sanity: every reported root must zero the ORIGINAL polynomial
  for (const r of out) {
    if (evalPoly(coeffs, r).p !== 0n) {
      throw makeRuntimeError("E_MATH_ASSERTION", "internal: rational root failed exact substitution");
    }
  }
  return out;
}

/** ExactNumber JSON from a Rat (int when denominator is 1). */
export function exactJson(r: Rat): any {
  return r.q === 1n ? { kind: "int", value: r.p.toString() } : { kind: "rational", p: r.p.toString(), q: r.q.toString() };
}

/** Exact bigint rational sqrt for perfect squares, else null. */
export function perfectSqrtRat(d2: Rat): Rat | null {
  // only for non-negative rationals
  if (d2.p < 0n) return null;
  const ps = bisqrt(d2.p), qs = bisqrt(d2.q);
  if (ps * ps !== d2.p || qs * qs !== d2.q) return null;
  return rat(ps, qs);
}
