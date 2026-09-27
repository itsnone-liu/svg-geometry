// Pure per-state evaluation: VerifiedFunctionProgram + context -> FunctionSnapshot.
//
// parameter sweep chain (frozen): presentation time -> model time t ->
// runtime value a_at_t -> function parameter a -> curve samples + claim
// points. No `a == t` implicit identity anywhere; outside every mapping
// window the runtime binding resolves to null and the curve/claims go
// INACTIVE deterministically (segments: [], position: null).

import { digestOf } from "../../../runtime/src/digest";
import { makeRuntimeError } from "../../../runtime/src/errors";
import { evalExpr, ExprAst } from "../../../runtime/src/expr/evaluate";
import { ratToNumber } from "../../../runtime/src/expr/exact";
import type { Rat } from "../../../runtime/src/expr/exact";
import type { DomainEvaluationContext } from "../../../runtime/src/domain";
import { sampleFunction } from "./sampling";
import { claimValueToNumber } from "./compile";
import type { FunctionClaim, FunctionSnapshot, FunctionSnapshotEntity, ParameterEnv, VerifiedFunctionProgram } from "./types";

type Env = Record<string, { kind: "exact"; r: Rat } | { kind: "num"; v: number }>;

function exprToNumber(ast: ExprAst, env: Env): number {
  const v = evalExpr(ast, env as any);
  return v.kind === "exact" ? ratToNumber(v.r) : v.v;
}

function ratNum(r: { p: string; q: string }): number {
  return ratToNumber({ p: BigInt(r.p), q: BigInt(r.q) });
}

/** Snapshot point for a claim under the CURRENT parameter values. */
function claimPosition(claim: FunctionClaim, program: VerifiedFunctionProgram, env: ParameterEnv | null): { x: number; y: number } | null {
  if (!env) return null;
  const fn = claim.functionIds.length ? program.functions.find((f) => f.id === claim.functionIds[0]) : undefined;
  const x = claimValueToNumber(claim.value, env, `claim '${claim.id}'`);
  switch (claim.kind) {
    case "roots":
    case "extremum": {
      const e: Env = { ...(env as Env) };
      e![fn!.variable] = { kind: "num", v: x };
      return { x, y: exprToNumber(fn!.expr, e) };
    }
    case "intersection": {
      const e: Env = { ...(env as Env) };
      e![fn!.variable] = { kind: "num", v: x };
      return { x, y: exprToNumber(fn!.expr, e) };
    }
    case "solve_equation": {
      const eq = program.equations.find((q) => q.id === claim.equationId)!;
      const e: Env = { ...(env as Env) };
      e![eq.variable] = { kind: "num", v: x };
      return { x, y: exprToNumber(eq.lhs, e) };
    }
    case "value_at":
    case "derivative_at": {
      // visual marker at the argument/value pair; for derivative_at the y
      // coordinate is f'(at), not a claim that this point lies on f itself
      return { x: ratNum(claim.at!), y: x };
    }
  }
}

export function evaluateFunction(program: VerifiedFunctionProgram, ctx: DomainEvaluationContext): FunctionSnapshot {
  const entities: Record<string, FunctionSnapshotEntity> = {};

  // ---- resolve parameter bindings per function ----
  const fnEnv = new Map<string, ParameterEnv | null>();
  for (const fn of program.functions) {
    const parameterValues: Record<string, number | null> = {};
    const env: Record<string, any> = {};
    let inactive = false;
    // Unbound Math parameters use their declared default value. Runtime
    // bindings override these defaults below; no implicit parameter==t rule.
    for (const [p, range] of Object.entries(program.parameterRanges)) {
      parameterValues[p] = range.def;
      env[p] = { kind: "num", v: range.def };
    }
    for (const [p, src] of Object.entries(fn.parameterBindings)) {
      // resolveBinding throws E_BINDING on genuinely missing targets (fail
      // closed); null alone means "outside mapping window" -> inactive.
      const raw = ctx.resolveBinding(src);
      let v: number | null = null;
      if (typeof raw === "number" && Number.isFinite(raw)) v = raw;
      else if (raw && typeof raw === "object" && (raw as any).kind === "int" && typeof (raw as any).value === "string" && /^-?(0|[1-9][0-9]*)$/.test((raw as any).value)) v = Number((raw as any).value);
      else if (raw && typeof raw === "object" && (raw as any).kind === "rational" && typeof (raw as any).p === "string" && typeof (raw as any).q === "string" && /^[1-9][0-9]*$/.test((raw as any).q)) v = Number((raw as any).p) / Number((raw as any).q);
      if (raw === null) {
        parameterValues[p] = null;
        inactive = true;
      } else if (v !== null && Number.isFinite(v)) {
        parameterValues[p] = v;
        env[p] = { kind: "num", v };
      } else {
        throw makeRuntimeError("E_BINDING", `function '${fn.id}' binding '${src}' did not resolve to a finite numeric parameter`);
      }
    }
    if (inactive) {
      entities[fn.id] = {
        kind: "function_curve",
        variable: fn.variable,
        parameterValues,
        segments: []
      };
      fnEnv.set(fn.id, null);
    } else {
      const numericParams: Record<string, number> = {};
      for (const [k, v] of Object.entries(parameterValues)) if (v !== null) numericParams[k] = v;
      const sampled = sampleFunction(fn, numericParams, program.samplingPolicy.sampleCount);
      entities[fn.id] = {
        kind: "function_curve",
        variable: fn.variable,
        parameterValues,
        segments: sampled.segments
      };
      fnEnv.set(fn.id, env as ParameterEnv);
    }
  }

  // ---- fact projection (P4.1): each derived fact reads under the CURRENT
  //      parameter values — symbolic roots a-1/a+1 become concrete points as
  //      the sweep runs. Scene draws these via `math:fact:<id>.point`; no
  //      drawable entities exist in Math IR (claim_point removed) ----
  const facts: Record<string, { kind: string; value: number | null; point: { x: number; y: number } | null }> = {};
  for (const claim of program.derivedClaims) {
    let env: ParameterEnv | null;
    if (claim.kind === "solve_equation") {
      env = {} as ParameterEnv; // equations carry no parameter bindings
    } else if (claim.functionIds.length > 0) {
      env = fnEnv.get(claim.functionIds[0]) ?? null;
    } else {
      env = null;
    }
    let value: number | null = null;
    if (env) {
      try { value = claimValueToNumber(claim.value, env as any, `claim '${claim.id}'`); } catch { value = null; }
    }
    facts[claim.id] = {
      kind: claim.kind,
      value,
      point: claimPosition(claim, program, env)
    };
  }

  const partial = { modelTime: ctx.modelTime, entities, facts };
  return { ...partial, digest: digestOf(partial) } as FunctionSnapshot;
}
