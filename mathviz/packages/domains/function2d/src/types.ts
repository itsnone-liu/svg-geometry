import type { DomainSnapshot } from "../../../runtime/src/domain";
import type { ExprAst, Env } from "../../../runtime/src/expr/evaluate";

/** JSON-safe exact rational; bigint arithmetic stays in the kernel. */
export interface ExactRational {
  kind: "rational";
  p: string;
  q: string;
}

/** A compiled y=f(x) curve over a finite x window with optional math
 *  parameters (e.g. `a`) bound to runtime sources. `x` is the function
 *  variable, `t` never appears here: model time only enters through
 *  parameter_bindings -> runtime values. */
export interface CompiledFunction {
  id: string;
  variable: string;
  expr: ExprAst;
  xMin: ExactRational;
  xMax: ExactRational;
  parameterBindings: Record<string, string>;
}

/** A frozen equation lhs(x) = rhs(x) solved by function2d.solve_equation. */
export interface CompiledEquation {
  id: string;
  lhs: ExprAst;
  rhs: ExprAst;
  variable: string;
}

export type FunctionClaimKind =
  | "roots"
  | "intersection"
  | "derivative_at"
  | "extremum"
  | "value_at"
  | "solve_equation";

/** A frozen derived fact re-verified at compile (numeric, fail-closed) and by
 *  the SymPy oracle at freeze (exact, complete). `values` holds ONE
 *  ExactNumber per claim; sets of roots are expressed as several facts
 *  sharing (capability, inputs). Symbolic values may reference math
 *  parameters (e.g. a-1) but never the function variable or `t`. */
export interface FunctionClaim {
  id: string;
  capabilityId: string;
  kind: FunctionClaimKind;
  functionIds: string[];
  equationId?: string;
  at?: ExactRational;
  value: any;
  parameterSymbols: string[];
}

export interface FunctionAssertion {
  assertionId: string;
  capabilityId: string;
  claimIds: string[];
  expectation: "holds" | "forbidden";
}

export interface FunctionSamplingPolicy {
  sampleCount: number;
  eps: number;
}

export interface VerifiedFunctionProgram {
  domain: "function2d";
  adapterVersion: string;
  functions: CompiledFunction[];
  equations: CompiledEquation[];
  derivedClaims: FunctionClaim[];
  assertions: FunctionAssertion[];
  samplingPolicy: FunctionSamplingPolicy;
  parameterRanges: Record<string, { min: number; max: number; def: number }>;
  digest: string;
}

export interface FunctionCurveSnapshotEntity {
  [key: string]: unknown;
  kind: "function_curve";
  variable: string;
  parameterValues: Record<string, number | null>;
  segments: Array<Array<{ x: number; y: number }>>;
}

export type FunctionSnapshotEntity = FunctionCurveSnapshotEntity;

/** P4.1: per-state projection of a derived fact, keyed by Math fact_id.
 * Math IR stays pure semantics (claim_point is gone); Scene draws a fact by
 * binding `math:fact:<fact_id>.point`, which resolves here snapshot-first.
 * `value` is the fact's numeric reading under the CURRENT parameter values
 * (null while the claim is inactive, e.g. a swept parameter outside every
 * mapping window); `point` is the drawable position or null. */
export interface FunctionFactSnapshot {
  [key: string]: unknown;
  kind: FunctionClaimKind;
  value: number | null;
  point: { x: number; y: number } | null;
}

export interface FunctionSnapshot extends DomainSnapshot {
  entities: Record<string, FunctionSnapshotEntity>;
  facts: Record<string, FunctionFactSnapshot>;
}

export type ParameterValues = Record<string, number | null>;
export type ParameterEnv = Env;
