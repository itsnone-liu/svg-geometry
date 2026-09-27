// ProblemSpec -> Math IR deterministic compiler (P5.0, frozen pipeline stage).
//
//   NL problem -> [P5.1 LLM parser] -> ProblemSpec v1 -> THIS COMPILER
//             -> Math IR v1 -> domain adapter -> Verified Domain Program
//
// The compiler is the ONLY thing allowed to produce Math IR from a spec, and
// it derives every answer itself:
//   - function2d.solve_equation : exact bigint rational-root solver
//     (packages/spec/src/poly.ts), completeness-certificate fail-closed
//   - motion1d goals            : bootstraps the EXISTING motion compiler
//     (compileMotion solves events exactly), harvests the solved
//     time/position, then re-compiles the final document — the emitted
//     derived facts are then VERIFIED by that same frozen compiler
//   - geometry2d.derive_length  : exact rational distance between two static
//     rational points (bigint perfect-square or symbolic sqrt)
//
// It never asks an LLM, never reads a clock, never samples randomly: same
// spec in, byte-identical Math IR out (proven by gate G16 / tests).

import { makeRuntimeError } from "../../runtime/src/errors";
import { validateProblemSpec } from "../../contracts/src/spec-validate";
import { validatorFor } from "../../contracts/src/load";
import { compileMotion } from "../../domains/motion1d/src/compile";
import { extractPolynomial, exactJson, rationalRoots, perfectSqrtRat } from "./poly";
import { rat, ratAdd, ratMul, ratSub, type Rat } from "../../runtime/src/expr/exact";
import { evalExpr } from "../../runtime/src/expr/evaluate";

export interface ProblemSpecGoalResult {
  goalId: string;
  capabilityId: string;
  /** fact ids this goal's answers were emitted as (derived_facts entries). */
  factIds: string[];
  /** event ids this goal emitted (motion events), if any. */
  eventIds: string[];
}

export interface CompiledSpec {
  /** Math IR v1 document (schema-valid, answer-bearing, fully provenanced). */
  math: any;
  goalResults: ProblemSpecGoalResult[];
}

function refId(ref: string, kind: "entity" | "fact"): string {
  const m = new RegExp(`^${kind}:([A-Za-z_][A-Za-z0-9_-]*)$`).exec(ref);
  if (!m) throw makeRuntimeError("E_SCHEMA", `expected ${kind}: reference, got '${ref}'`);
  return m[1]!;
}

function requireEntity(spec: any, id: string): any {
  const e = (spec.entities ?? []).find((x: any) => x?.id === id);
  if (!e) throw makeRuntimeError("E_BINDING", `entity '${id}' not found in spec`);
  return e;
}

// ---------------- function2d: solve_equation ----------------

function solveFunction2dGoal(spec: any, goal: any, math: any, result: ProblemSpecGoalResult): void {
  if (goal.capabilityId !== "function2d.solve_equation") {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `spec compiler: function2d goal '${goal.capabilityId}' not wired in v1`);
  }
  const eqId = refId(goal.inputs[0], "entity");
  const eq = requireEntity(spec, eqId);
  if (eq.kind !== "equation") {
    throw makeRuntimeError("E_BINDING", `goal '${goal.goalId}': input entity '${eqId}' is not an equation`);
  }
  const variable: string = eq.props?.variable ?? "x";
  const lhs = eq.props?.lhs, rhs = eq.props?.rhs;
  if (!lhs || !rhs) throw makeRuntimeError("E_SCHEMA", `equation '${eqId}' needs props.lhs and props.rhs`);

  // p(x) = lhs - rhs, coefficients low->high
  const left = extractPolynomial(lhs, variable);
  const right = extractPolynomial(rhs, variable);
  const n = Math.max(left.length, right.length);
  const coeffs: Rat[] = [];
  for (let i = 0; i < n; i++) coeffs.push(ratSub(left[i] ?? rat(0n), right[i] ?? rat(0n)));
  const roots = rationalRoots(coeffs);

  // independent re-verification through the frozen runtime evaluator:
  // substituting each root must make lhs == rhs exactly
  for (const r of roots) {
    const env: any = { [variable]: { kind: "exact", r } };
    const lv = evalExpr(lhs, env), rv = evalExpr(rhs, env);
    const ok =
      lv.kind === "exact" && rv.kind === "exact" && lv.r.p === rv.r.p && lv.r.q === rv.r.q;
    if (!ok) throw makeRuntimeError("E_MATH_ASSERTION", `root ${r.p}/${r.q} failed independent substitution check`);
  }

  roots.forEach((r, i) => {
    const factId = `${goal.goalId}_sol_${i + 1}`;
    math.derived_facts.push({
      fact_id: factId,
      name: `${goal.goalId} solution ${i + 1}`,
      value: exactJson(r),
      provenance: { kind: "derived", capability_id: goal.capabilityId, inputs: [`entity:${eqId}`] }
    });
    result.factIds.push(factId);
  });
}

// ---------------- motion1d: meeting/overtake events ----------------

function solveMotionGoal(spec: any, goal: any, math: any, result: ProblemSpecGoalResult): void {
  const cap: string = goal.capabilityId;
  if (cap !== "motion1d.meeting_event" && cap !== "motion1d.overtake_event" && cap !== "motion1d.reach_event") {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `spec compiler: motion1d goal '${cap}' not wired in v1`);
  }
  // Bootstrap: solve the event with the FROZEN motion compiler, WITHOUT the
  // declared time (compileEvents solves and verifies `at` only if present).
  const bootstrap = structuredClone(math);
  bootstrap.derived_facts = [];
  bootstrap.events = [{ event_id: goal.goalId, capability_id: cap, participants: goal.inputs }];
  const solved = compileMotion(bootstrap);
  const ev = solved.events.find((e: any) => e.eventId === goal.goalId);
  if (!ev) throw makeRuntimeError("E_MATH_ASSERTION", `motion compiler produced no event for goal '${goal.goalId}'`);

  // Emit the event WITH its solved time, plus the two derived facts the
  // existing Math IR convention carries (time + position). The final
  // compileMotion call below re-verifies both facts against its own solver.
  const timeFactId = `${goal.goalId}_time`;
  const posFactId = `${goal.goalId}_pos`;
  math.events = [{ event_id: goal.goalId, capability_id: cap, participants: goal.inputs, at: ev.time }];
  math.derived_facts.push({
    fact_id: timeFactId,
    name: `${goal.goalId} time`,
    unit: "s",
    value: ev.time,
    provenance: { kind: "derived", capability_id: cap, inputs: goal.inputs }
  });
  math.derived_facts.push({
    fact_id: posFactId,
    name: `${goal.goalId} position`,
    unit: "m",
    value: ev.position,
    provenance: {
      kind: "derived",
      capability_id: "motion1d.solve_position",
      inputs: [goal.inputs[0], `fact:${timeFactId}`]
    }
  });
  result.factIds.push(timeFactId, posFactId);
  result.eventIds.push(goal.goalId);
}

// ---------------- geometry2d: derive_length ----------------

/** Parse a rational literal from the Geometry DSL coordinate string ("2", "-3/4"). */
function parseRationalLiteral(s: unknown, where: string): Rat {
  if (typeof s !== "string") throw makeRuntimeError("E_SCHEMA", `${where}: coordinate must be a string literal`);
  const m = /^(-?)(?:(\d+)(?:\/(\d+))?)$/.exec(s.trim());
  if (!m) {
    throw makeRuntimeError(
      "E_CAPABILITY_UNSUPPORTED",
      `${where}: coordinate '${s}' is not a rational literal (irrational DSL expressions are outside the spec compiler v1)`
    );
  }
  const neg = m[1] === "-";
  const p = BigInt((neg ? "-" : "") + (m[2] ?? "0"));
  const q = BigInt(m[3] ?? "1");
  if (q === 0n) throw makeRuntimeError("E_SCHEMA", `${where}: zero denominator`);
  return rat(p, q);
}

function solveGeometryGoal(spec: any, goal: any, math: any, result: ProblemSpecGoalResult): void {
  if (goal.capabilityId !== "geometry2d.derive_length") {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `spec compiler: geometry2d goal '${goal.capabilityId}' not wired in v1`);
  }
  const segId = refId(goal.inputs[0], "entity");
  const seg = requireEntity(spec, segId);
  if (seg.kind !== "segment") {
    throw makeRuntimeError("E_BINDING", `goal '${goal.goalId}': input entity '${segId}' is not a segment`);
  }
  const a = requireEntity(spec, String(seg.props?.a));
  const b = requireEntity(spec, String(seg.props?.b));
  if (a.kind !== "point" || b.kind !== "point") {
    throw makeRuntimeError("E_BINDING", `segment '${segId}' endpoints must be point entities`);
  }
  const ax = parseRationalLiteral(a.props?.x, `point '${a.id}' x`), ay = parseRationalLiteral(a.props?.y, `point '${a.id}' y`);
  const bx = parseRationalLiteral(b.props?.x, `point '${b.id}' x`), by = parseRationalLiteral(b.props?.y, `point '${b.id}' y`);
  const dx = ratSub(bx, ax), dy = ratSub(by, ay);
  const d2 = ratAdd(ratMul(dx, dx), ratMul(dy, dy));
  const exact = perfectSqrtRat(d2);
  const value = exact
    ? exactJson(exact)
    : { kind: "symbolic", expr: { t: "app", op: "^", args: [{ t: "num", v: exactJson(d2) }, { t: "num", v: { kind: "rational", p: "1", q: "2" } }] } };

  const factId = `${goal.goalId}_length`;
  math.derived_facts.push({
    fact_id: factId,
    name: `${goal.goalId} length of ${segId}`,
    value,
    provenance: { kind: "derived", capability_id: goal.capabilityId, inputs: [`entity:${segId}`] }
  });
  result.factIds.push(factId);
}

// ---------------- top-level compile ----------------

export function compileProblemSpec(spec: any): CompiledSpec {
  // 1. structural + semantic validation — loud failure, never silent repair
  const specValidator = validatorFor("problemspec");
  if (!specValidator(spec)) {
    throw makeRuntimeError("E_SCHEMA", "ProblemSpec violates the frozen schema: " + JSON.stringify(specValidator.errors));
  }
  const semantic = validateProblemSpec(spec);
  if (semantic.length > 0) {
    // surface the FIRST semantic error's own code (e.g. E_BINDING /
    // E_CAPABILITY_UNSUPPORTED) — the P5.1 repair loop will need real codes
    throw makeRuntimeError(
      semantic[0]!.code as any,
      `invalid ProblemSpec (${semantic.length} errors): ${semantic.map((e) => e.message).join(" | ")}`
    );
  }

  // 2. source layer passes through verbatim EXCEPT spec-layer provenance:
  //    Math IR v1 entities/constraints have no provenance field (that schema
  //    is frozen with additionalProperties:false) — the spec document stays
  //    the audit artifact for entity/constraint provenance.
  const stripProvenance = <T,>(arr: T[]): T[] =>
    arr.map((x: any) => {
      const { provenance: _drop, ...rest } = x ?? {};
      return rest as T;
    });
  const math: any = {
    schemaVersion: "mathviz.math/v1",
    problemId: spec.problemId,
    domain: spec.domain,
    statement: spec.statement,
    parameters: structuredClone(spec.parameters ?? []),
    entities: stripProvenance(structuredClone(spec.entities ?? [])),
    source_facts: structuredClone(spec.source_facts ?? []),
    derived_facts: [],
    runtime_values: [],
    constraints: stripProvenance(structuredClone(spec.constraints ?? [])),
    assertions: [],
    capabilities: []
  };
  const usedCapabilities = new Set<string>();
  for (const e of math.entities) {
    const cap = e?.props?.capability_id;
    if (typeof cap === "string") usedCapabilities.add(cap);
  }

  // 3. answer each goal with the deterministic solver for its domain
  const goalResults: ProblemSpecGoalResult[] = [];
  for (const goal of spec.goals) {
    const result: ProblemSpecGoalResult = { goalId: goal.goalId, capabilityId: goal.capabilityId, factIds: [], eventIds: [] };
    if (spec.domain === "function2d") solveFunction2dGoal(spec, goal, math, result);
    else if (spec.domain === "motion1d") solveMotionGoal(spec, goal, math, result);
    else if (spec.domain === "geometry2d") solveGeometryGoal(spec, goal, math, result);
    else throw makeRuntimeError("E_SCHEMA", `unknown domain '${spec.domain}'`);
    if (result.factIds.length === 0 && result.eventIds.length === 0) {
      throw makeRuntimeError("E_MATH_ASSERTION", `goal '${goal.goalId}' produced no answers`);
    }
    goalResults.push(result);
  }
  if (spec.domain === "motion1d" && !math.events) math.events = [];
  // capabilities must cover EVERYTHING the document uses (entity, constraint,
  // event, and derived-fact capabilities), mirroring the domain compilers'
  // `used` sets so gate G3 sees a closed declaration.
  for (const e of math.entities) {
    const cap = e?.props?.capability_id;
    if (typeof cap === "string") usedCapabilities.add(cap);
  }
  for (const c of math.constraints ?? []) {
    if (typeof c?.capability_id === "string") usedCapabilities.add(c.capability_id);
  }
  for (const e of math.events ?? []) {
    if (typeof e?.capability_id === "string") usedCapabilities.add(e.capability_id);
  }
  for (const f of math.derived_facts) {
    const cap = f?.provenance?.capability_id;
    if (typeof cap === "string") usedCapabilities.add(cap);
  }
  math.capabilities = [...usedCapabilities].sort();

  // 4. the emitted document must satisfy the frozen Math IR schema
  const mathValidator = validatorFor("math");
  if (!mathValidator(math)) {
    throw makeRuntimeError("E_SCHEMA", "compiler output violates mathviz.math/v1: " + JSON.stringify(mathValidator.errors));
  }
  return { math, goalResults };
}
