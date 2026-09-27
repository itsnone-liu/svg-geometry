// Domain Provider extension point (P2).
//
// The runtime stays domain-agnostic: it owns THIS interface and evaluates
// whatever adapter the host registers for `math.domain`. Adapters are pure:
// compile() runs ONCE at load time; evaluate() is a pure function of
// (program, context) — no DOM, no wall clock, no randomness, no previous
// frame. Geometry2D is the first implementation (packages/domains/geometry2d);
// motion1d / function2d follow the same shape later.
//
// Dependency direction: domains packages may import runtime TYPES; the
// runtime NEVER imports any domain package (structural typing only), so the
// browser bundle composition is decided by the entry point, not the core.

import { Env } from "./expr/evaluate";

export interface DomainSnapshotEntity {
  kind: string;
  [key: string]: unknown;
}

/** P4.1: dynamic per-state projection of a (derived) Math fact. The Math
 * document owns WHAT the fact is (semantics, provenance); the domain adapter
 * projects HOW that fact reads under the CURRENT runtime state — e.g. a
 * symbolic root a-1 becomes a concrete point once the parameter `a` is bound.
 * Scene binds `math:fact:<fact_id>.point`; no drawing-motivated entities are
 * ever added to Math IR (claim_point removed). Cross-domain by design:
 * motion event facts and geometry dynamic facts project the same way. */
export interface DomainFactSnapshot {
  /** semantic kind, e.g. "roots" | "intersection" | "extremum" | "event". */
  kind: string;
  [key: string]: unknown;
}

/** Opaque-to-the-runtime domain snapshot: entities keyed by id + digest.
 * `facts` (P4.1, optional) is the fact projection layer, keyed by Math
 * fact_id; it participates in the snapshot digest whenever present. */
export interface DomainSnapshot {
  modelTime: number | null;
  entities: Record<string, DomainSnapshotEntity>;
  facts?: Record<string, DomainFactSnapshot>;
  digest: string;
}

export interface DomainProgram {
  digest: string;
}

export interface DomainEvaluationContext {
  modelTime: number | null;
  /** Reserved-symbol environment (`t` present only inside mapping windows). */
  env: Env;
  /** Resolve a `math:...` binding source in the CURRENT state (used by
   *  dynamic geometry parameters, e.g. rotate angle = runtime:theta_at_t). */
  resolveBinding(source: string): unknown;
}

export interface AssertionOutcome {
  assertion_id: string;
  capability: string;
  pass: boolean;
  expectation: "holds" | "forbidden";
  subjects: string[];
  detail?: string;
}

export interface DomainAdapter<P extends DomainProgram = DomainProgram> {
  readonly domain: string;
  readonly version: string;
  supports(capabilityId: string): boolean;
  /** Once, at load time. Throws VizRuntimeError (E_SCHEMA / E_BINDING /
   *  E_CAPABILITY_UNSUPPORTED / E_MATH_CONSTRAINT) on invalid programs. */
  compile(math: unknown): P;
  /** Pure per-state evaluation in dependency order. */
  evaluate(program: P, ctx: DomainEvaluationContext): DomainSnapshot;
  /** Predicate results for the snapshot (G5). */
  assert(program: P, snapshot: DomainSnapshot): AssertionOutcome[];
}

export interface DomainContext {
  adapter: DomainAdapter;
  program: DomainProgram;
}

/** Entity binding resolution order (P2 frozen):
 *  1. domain snapshot entity (when an adapter ran and produced it)
 *  2. fallback: static Math entity `props` walk (P1 behavior, unchanged)
 *  The fallback is only legitimate for entities the domain did not compute
 *  (truly static payloads) — dynamic geometry MUST come from the snapshot. */
export function snapshotEntity(snapshot: DomainSnapshot | null, id: string): DomainSnapshotEntity | null {
  if (!snapshot) return null;
  const e = snapshot.entities[id];
  return e ?? null;
}
