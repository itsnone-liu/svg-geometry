// Function2D compiler: Math IR -> VerifiedFunctionProgram (P4 §8–§15).
//
// Fail-closed without SymPy: every frozen derived claim is re-validated here
// NUMERICALLY over deterministic parameter samples drawn from the declared
// parameter ranges (root r: |f(r)| <= eps*scale; extremum: |f'(x*)| <= eps;
// derivative_at: TS-symbolic derivative vs claimed value; ...). SymPy (G13)
// separately proves exactness AND completeness at freeze time — two
// independent implementations cross-checking each other.

import { makeRuntimeError } from "../../../runtime/src/errors";
import { digestOf } from "../../../runtime/src/digest";
import { evalExpr, ExprAst } from "../../../runtime/src/expr/evaluate";
import { ratToNumber } from "../../../runtime/src/expr/exact";
import type { Rat } from "../../../runtime/src/expr/exact";
import {
  FUNCTION2D_ADAPTER_VERSION,
  FUNCTION2D_CAPABILITIES,
  CAPABILITY_TO_CLAIM_KIND
} from "./constants";
import { assertDifferentiable, differentiate } from "./differentiate";
import type {
  CompiledEquation,
  CompiledFunction,
  ExactRational,
  FunctionAssertion,
  FunctionClaim,
  FunctionClaimKind,
  VerifiedFunctionProgram
} from "./types";

type Env = Record<string, { kind: "exact"; r: Rat } | { kind: "num"; v: number }>;

function err(code: any, msg: string): never {
  throw makeRuntimeError(code, msg);
}

function toExactRational(v: any, where: string): ExactRational {
  if (v && typeof v === "object") {
    if (v.kind === "int" && typeof v.value === "string" && /^-?(0|[1-9][0-9]*)$/.test(v.value)) {
      return { kind: "rational", p: v.value, q: "1" };
    }
    if (v.kind === "rational" && typeof v.p === "string" && typeof v.q === "string" &&
        /^-?(0|[1-9][0-9]*)$/.test(v.p) && /^[1-9][0-9]*$/.test(v.q) && v.q !== "0") {
      return { kind: "rational", p: v.p, q: v.q };
    }
  }
  return err("E_SCHEMA", `${where}: expected an exact int/rational number`);
}

function ratNum(r: ExactRational): number {
  return ratToNumber({ p: BigInt(r.p), q: BigInt(r.q) });
}

function freeSymbols(ast: any, acc: Set<string> = new Set()): Set<string> {
  if (!ast || typeof ast !== "object") return acc;
  if (ast.t === "sym" && typeof ast.name === "string") acc.add(ast.name);
  if (ast.t === "num" && ast.v?.kind === "symbolic") freeSymbols(ast.v.expr, acc);
  if (Array.isArray(ast.args)) for (const a of ast.args) freeSymbols(a, acc);
  return acc;
}

function exprToNumber(ast: ExprAst, env: Env): number {
  const v = evalExpr(ast, env as any);
  return v.kind === "exact" ? ratToNumber(v.r) : v.v;
}

/** ExactNumber (int/rational/symbolic-in-params) -> number under given params. */
export function claimValueToNumber(value: any, env: Env, where: string): number {
  if (!value || typeof value !== "object") err("E_SCHEMA", `${where}: claim value must be an object`);
  if (value.kind === "int" || value.kind === "rational") return ratNum(toExactRational(value, where));
  if (value.kind === "symbolic" && value.expr && typeof value.expr === "object") {
    return exprToNumber(value.expr, env);
  }
  if (value.kind === "finite_set" && Array.isArray(value.values) && value.values.length === 1) {
    return claimValueToNumber(value.values[0], env, where);
  }
  return err("E_SCHEMA", `${where}: unsupported claim value form '${value.kind}'`);
}

const PARAMETER_SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

function parameterSamplePoints(ranges: Record<string, { min: number; max: number; def: number }>): Array<Record<string, number>> {
  const names = Object.keys(ranges);
  if (names.length === 0) return [{}];
  let combos: Array<Record<string, number>> = [{}];
  for (const name of names) {
    const { min, max } = ranges[name];
    const next: Array<Record<string, number>> = [];
    for (const base of combos) {
      for (const f of PARAMETER_SAMPLE_FRACTIONS) {
        next.push({ ...base, [name]: min + f * (max - min) });
      }
    }
    combos = next.slice(0, 64); // deterministic guard, fixtures use <= 1 param
  }
  return combos;
}

function envFor(params: Record<string, number>): Env {
  const env: Env = {};
  for (const k of Object.keys(params)) env[k] = { kind: "num", v: params[k] };
  return env;
}

function evalFunctionAt(fn: CompiledFunction, x: number, env: Env, where: string): number {
  const e: Env = { ...env };
  e[fn.variable] = { kind: "num", v: x };
  return exprToNumber(fn.expr, e);
}

function tolAt(x: number, eps: number): number {
  return eps * (1 + Math.abs(x));
}

export function compileFunction(math: any): VerifiedFunctionProgram {
  if (!math || typeof math !== "object") err("E_SCHEMA", "function2d compile: math document required");
  if (math.domain !== "function2d") err("E_SCHEMA", `function2d compile: domain is '${math.domain}'`);

  // ---- parameters ----
  const parameterRanges: Record<string, { min: number; max: number; def: number }> = {};
  for (const p of math.parameters ?? []) {
    if (!p || typeof p.id !== "string" || !p.id) err("E_SCHEMA", "parameter needs an id");
    if (p.id === "t") err("E_MATH_CONSTRAINT", `parameter '${p.id}': 't' is reserved for model time`);
    const min = ratNum(toExactRational(p.min, `parameter '${p.id}'.min`));
    const max = ratNum(toExactRational(p.max, `parameter '${p.id}'.max`));
    const def = p.default !== undefined ? ratNum(toExactRational(p.default, `parameter '${p.id}'.default`)) : min;
    if (!(max > min)) err("E_MATH_CONSTRAINT", `parameter '${p.id}': max must exceed min`);
    parameterRanges[p.id] = { min, max, def };
  }
  const parameterIds = new Set(Object.keys(parameterRanges));

  // ---- entities ----
  const functions: CompiledFunction[] = [];
  const equations: CompiledEquation[] = [];
  const functionById = new Map<string, CompiledFunction>();
  const equationById = new Map<string, CompiledEquation>();
  let anyRuntimeBinding = false;
  const usedCapabilities = new Set<string>();

  for (const e of math.entities ?? []) {
    if (!e || typeof e.id !== "string" || !e.id) err("E_SCHEMA", "entity needs an id");
    const props = e.props ?? {};
    const cap = props.capability_id;
    if (e.kind === "function") {
      if (cap !== "function2d.expression_curve") {
        err("E_CAPABILITY_UNSUPPORTED", `function entity '${e.id}': capability '${cap}' is not function2d.expression_curve`);
      }
      const variable = props.variable;
      if (typeof variable !== "string" || !/^[a-z][a-z0-9_]*$/.test(variable) || variable === "t") {
        err("E_SCHEMA", `function entity '${e.id}': invalid variable '${String(variable)}'`);
      }
      if (parameterIds.has(variable)) {
        err("E_MATH_CONSTRAINT", `function entity '${e.id}': variable '${variable}' collides with a parameter id`);
      }
      const expr = props.expr;
      if (!expr || typeof expr !== "object") err("E_SCHEMA", `function entity '${e.id}': expr required`);
      const syms = freeSymbols(expr);
      for (const s of syms) {
        if (s === variable || s === "pi" || s === "e") continue;
        if (parameterIds.has(s)) continue;
        err("E_MATH_CONSTRAINT", `function entity '${e.id}': free symbol '${s}' is neither the variable, a symbolic constant, nor a declared parameter`);
      }
      const domain = props.x_domain;
      const xMinR = toExactRational(domain?.min, `function entity '${e.id}'.x_domain.min`);
      const xMaxR = toExactRational(domain?.max, `function entity '${e.id}'.x_domain.max`);
      if (!(ratNum(xMaxR) > ratNum(xMinR))) {
        err("E_MATH_CONSTRAINT", `function entity '${e.id}': x_domain max must exceed min`);
      }
      const parameterBindings: Record<string, string> = {};
      if (props.parameter_bindings && typeof props.parameter_bindings === "object") {
        for (const [k, src] of Object.entries(props.parameter_bindings)) {
          if (!parameterIds.has(k)) {
            err("E_BINDING", `function entity '${e.id}': parameter binding '${k}' is not a declared parameter`);
          }
          if (typeof src !== "string" || !/^math:(entity|fact|param|runtime):/.test(src)) {
            err("E_BINDING", `function entity '${e.id}': parameter binding '${k}' must be a math: source`);
          }
          if (src.startsWith("math:runtime:")) anyRuntimeBinding = true;
          parameterBindings[k] = src;
        }
      }
      // extremum/derivative_at need symbolic differentiation: reject
      // known-underivable shapes UP FRONT so unsupported programs fail at
      // compile, not mid-evaluation.
      const fn: CompiledFunction = { id: e.id, variable, expr, xMin: xMinR, xMax: xMaxR, parameterBindings };
      functionById.set(fn.id, fn);
      functions.push(fn);
      usedCapabilities.add("function2d.expression_curve");
    } else if (e.kind === "equation") {
      if (cap !== "function2d.solve_equation") {
        err("E_CAPABILITY_UNSUPPORTED", `equation entity '${e.id}': capability '${cap}' is not function2d.solve_equation`);
      }
      const variable = props.variable;
      if (typeof variable !== "string" || !/^[a-z][a-z0-9_]*$/.test(variable) || variable === "t") {
        err("E_SCHEMA", `equation entity '${e.id}': invalid variable '${String(variable)}'`);
      }
      const lhs = props.lhs, rhs = props.rhs;
      if (!lhs || !rhs || typeof lhs !== "object" || typeof rhs !== "object") {
        err("E_SCHEMA", `equation entity '${e.id}': lhs/rhs expressions required`);
      }
      const equationSymbols = new Set<string>([...freeSymbols(lhs), ...freeSymbols(rhs)]);
      for (const s of equationSymbols) {
        if (s !== variable && s !== "pi" && s !== "e") {
          err("E_MATH_CONSTRAINT", `equation entity '${e.id}': symbol '${s}' is not the equation variable or a supported numeric constant (parameterized equations are not in P4 scope)`);
        }
      }
      const eq: CompiledEquation = { id: e.id, lhs, rhs, variable };
      equationById.set(eq.id, eq);
      equations.push(eq);
      usedCapabilities.add("function2d.solve_equation");
    } else {
      // P4.1: `claim_point` entities were removed from Math IR — drawing a
      // derived fact now goes through the snapshot fact projection and a
      // Scene binding `math:fact:<fact_id>.point`; nothing drawable lives in
      // the Math document. Any leftover drawing-motivated entity kind is
      // rejected here so stale producers fail loudly.
      err("E_CAPABILITY_UNSUPPORTED", `function2d compile: entity '${e.id}' has unsupported kind '${e.kind}'`);
    }
  }
  if (functions.length === 0 && equations.length === 0) {
    err("E_MATH_CONSTRAINT", "function2d compile: at least one function or equation entity is required");
  }

  // ---- derived facts -> claims ----
  const factValueById = new Map<string, any>();
  for (const f of [...(math.source_facts ?? []), ...(math.derived_facts ?? [])]) {
    if (f && typeof f.fact_id === "string") factValueById.set(f.fact_id, f.value);
  }

  const claims: FunctionClaim[] = [];
  const claimById = new Map<string, FunctionClaim>();
  for (const f of math.derived_facts ?? []) {
    if (!f || typeof f.fact_id !== "string" || !f.fact_id) err("E_SCHEMA", "derived fact needs fact_id");
    const cap = f.capability_id ?? f.provenance?.capability_id;
    const kindStr = CAPABILITY_TO_CLAIM_KIND[cap];
    if (!kindStr) {
      err("E_CAPABILITY_UNSUPPORTED", `derived fact '${f.fact_id}': capability '${String(cap)}' is not a function2d claim capability`);
    }
    const inputs: string[] = Array.isArray(f.inputs) ? f.inputs : Array.isArray(f.provenance?.inputs) ? f.provenance.inputs : [];
    const value = f.value;
    if (!value || typeof value !== "object") err("E_SCHEMA", `derived fact '${f.fact_id}': value required`);
    const valueSymbols = new Set<string>();
    const collectSymbols = (v: any): void => {
      if (v?.kind === "symbolic" && v.expr) for (const s of freeSymbols(v.expr)) valueSymbols.add(s);
      if (v?.kind === "finite_set" && Array.isArray(v.values)) v.values.forEach(collectSymbols);
    };
    collectSymbols(value);
    for (const s of valueSymbols) {
      if (!parameterIds.has(s)) {
        err("E_MATH_CONSTRAINT", `derived fact '${f.fact_id}': value symbol '${s}' is not a declared parameter`);
      }
    }
    const claim: FunctionClaim = {
      id: f.fact_id,
      capabilityId: cap,
      kind: kindStr as FunctionClaimKind,
      functionIds: [],
      equationId: undefined,
      at: undefined,
      value,
      parameterSymbols: [...valueSymbols].sort()
    };

    // resolve inputs per claim kind
    const refId = (ref: string): string => {
      const m = /^(?:entity|fact):([A-Za-z_][A-Za-z0-9_-]*)$/.exec(ref ?? "");
      if (!m) err("E_BINDING", `derived fact '${f.fact_id}': bad input ref '${String(ref)}'`);
      return m![1];
    };
    if (kindStr === "solve_equation") {
      const eqId = refId(inputs[0]);
      if (!equationById.has(eqId)) err("E_BINDING", `derived fact '${f.fact_id}': input is not an equation entity`);
      claim.equationId = eqId;
    } else {
      if (kindStr === "intersection") {
        if (inputs.length < 2) err("E_BINDING", `derived fact '${f.fact_id}': intersection needs two function inputs`);
        const a = refId(inputs[0]), b = refId(inputs[1]);
        if (!functionById.has(a) || !functionById.has(b)) err("E_BINDING", `derived fact '${f.fact_id}': intersection inputs must be function entities`);
        claim.functionIds = [a, b];
      } else {
        const fid = refId(inputs[0]);
        if (!functionById.has(fid)) err("E_BINDING", `derived fact '${f.fact_id}': input must be a function entity`);
        claim.functionIds = [fid];
        if (kindStr === "derivative_at" || kindStr === "value_at") {
          const atRef = inputs[1];
          let atValue: any;
          if (typeof atRef === "string" && atRef.startsWith("fact:")) {
            atValue = factValueById.get(refId(atRef));
          } else if (f.params && typeof f.params === "object" && f.params.at !== undefined) {
            atValue = f.params.at;
          }
          claim.at = toExactRational(atValue, `derived fact '${f.fact_id}' at-point`);
        }
      }
    }
    claims.push(claim);
    claimById.set(claim.id, claim);
    usedCapabilities.add(cap);
  }

  // parameter sweep: any runtime-bound parameter REQUIRES the declared
  // capability (honest support boundary, no implicit a == t)
  if (anyRuntimeBinding) usedCapabilities.add("function2d.parameter_sweep");

  // ---- assertions ----
  const assertions: FunctionAssertion[] = [];
  for (const a of math.assertions ?? []) {
    if (!a || typeof a.assertion_id !== "string" || !a.assertion_id) err("E_SCHEMA", "assertion needs assertion_id");
    const cap = a.capability_id;
    if (!CAPABILITY_TO_CLAIM_KIND[cap]) {
      err("E_CAPABILITY_UNSUPPORTED", `assertion '${a.assertion_id}': capability '${String(cap)}' is not a function2d claim capability`);
    }
    const claimIds: string[] = [];
    for (const ref of a.subject_refs ?? []) {
      const m = /^fact:([A-Za-z_][A-Za-z0-9_-]*)$/.exec(String(ref));
      if (!m || !claimById.has(m[1])) {
        err("E_BINDING", `assertion '${a.assertion_id}': subject '${String(ref)}' is not a derived function claim`);
      }
      claimIds.push(m![1]);
    }
    if (claimIds.length === 0) err("E_BINDING", `assertion '${a.assertion_id}': at least one claim subject required`);
    assertions.push({
      assertionId: a.assertion_id,
      capabilityId: cap,
      claimIds,
      expectation: a.expectation === "forbidden" ? "forbidden" : "holds"
    });
    usedCapabilities.add(cap);
  }

  // ---- capability closure ----
  const declared = new Set<string>(math.capabilities ?? []);
  for (const c of usedCapabilities) {
    if (!FUNCTION2D_CAPABILITIES.has(c)) err("E_CAPABILITY_UNSUPPORTED", `function2d adapter does not implement '${c}'`);
    if (!declared.has(c)) err("E_CAPABILITY_UNSUPPORTED", `capability '${c}' is used but not declared in math.capabilities`);
  }
  if (anyRuntimeBinding && !declared.has("function2d.parameter_sweep")) {
    err("E_CAPABILITY_UNSUPPORTED", "math.capabilities must declare function2d.parameter_sweep when parameters bind runtime sources");
  }

  // ---- differentiability pre-check when derivative-dependent claims exist ----
  const needsDerivative = claims.some((c) => c.kind === "extremum" || c.kind === "derivative_at");
  if (needsDerivative) {
    for (const fn of functions) assertDifferentiable(fn.expr, `function entity '${fn.id}'`);
  }

  // ---- fail-closed numeric validation over parameter samples ----
  const samples = parameterSamplePoints(parameterRanges);
  const eps = 1e-9;
  for (const claim of claims) {
    for (const params of samples) {
      const env = envFor(params);
      const where = `derived fact '${claim.id}'`;
      const x = claimValueToNumber(claim.value, env, where);
      if (!Number.isFinite(x)) err("E_MATH_CONSTRAINT", `${where}: value is not finite at sample params ${JSON.stringify(params)}`);
      const tol = tolAt(x, eps);
      switch (claim.kind) {
        case "roots": {
          const fn = functionById.get(claim.functionIds[0])!;
          const y = evalFunctionAt(fn, x, env, where);
          if (Math.abs(y) > tol) err("E_MATH_ASSERTION", `${where}: claimed root ${x} gives f=${y} (tol ${tol}) at params ${JSON.stringify(params)}`);
          break;
        }
        case "intersection": {
          const [fa, fb] = claim.functionIds.map((id) => functionById.get(id)!);
          const ya = evalFunctionAt(fa, x, env, where);
          const yb = evalFunctionAt(fb, x, env, where);
          if (Math.abs(ya - yb) > tol) err("E_MATH_ASSERTION", `${where}: claimed intersection ${x} gives f=${ya} g=${yb} at params ${JSON.stringify(params)}`);
          break;
        }
        case "solve_equation": {
          const eq = equationById.get(claim.equationId!)!;
          const e2: Env = { ...env };
          e2[eq.variable] = { kind: "num", v: x };
          const lhs = exprToNumber(eq.lhs, e2);
          const rhs = exprToNumber(eq.rhs, e2);
          if (Math.abs(lhs - rhs) > tol) err("E_MATH_ASSERTION", `${where}: claimed solution ${x} gives lhs=${lhs} rhs=${rhs}`);
          break;
        }
        case "derivative_at": {
          const fn = functionById.get(claim.functionIds[0])!;
          const at = ratNum(claim.at!);
          const dAst = differentiate(fn.expr, fn.variable);
          const e2: Env = { ...env };
          e2[fn.variable] = { kind: "num", v: at };
          const d = exprToNumber(dAst, e2);
          if (Math.abs(d - x) > tolAt(at, eps)) err("E_MATH_ASSERTION", `${where}: claimed derivative ${x} but f'(${at})=${d} at params ${JSON.stringify(params)}`);
          break;
        }
        case "value_at": {
          const fn = functionById.get(claim.functionIds[0])!;
          const at = ratNum(claim.at!);
          const y = evalFunctionAt(fn, at, env, where);
          if (Math.abs(y - x) > tolAt(at, eps)) err("E_MATH_ASSERTION", `${where}: claimed value ${x} but f(${at})=${y} at params ${JSON.stringify(params)}`);
          break;
        }
        case "extremum": {
          const fn = functionById.get(claim.functionIds[0])!;
          const dAst = differentiate(fn.expr, fn.variable);
          const e2: Env = { ...env };
          e2[fn.variable] = { kind: "num", v: x };
          const d = exprToNumber(dAst, e2);
          if (Math.abs(d) > tol) err("E_MATH_ASSERTION", `${where}: claimed extremum ${x} gives f'=${d} (tol ${tol}) at params ${JSON.stringify(params)}`);
          break;
        }
      }
    }
  }

  const base = {
    domain: "function2d" as const,
    adapterVersion: FUNCTION2D_ADAPTER_VERSION,
    functions,
    equations,
    derivedClaims: claims,
    assertions,
    samplingPolicy: { sampleCount: 257, eps },
    parameterRanges
  };
  return { ...base, digest: digestOf(base) };
}
