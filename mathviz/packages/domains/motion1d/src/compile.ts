import { digestOf } from "../../../runtime/src/digest";
import { makeRuntimeError } from "../../../runtime/src/errors";
import { rat, add, sub, mul, cmp, eq } from "./rational";
import { fromJson, fromExact, toExact } from "./exact";
import { normalize, unitInfo, type Dimension } from "./units";
import { solvePairEvent, solveReachEvent, positionOnBody } from "./events";
import type { MotionBodyProgram, MotionEventKind, MotionSegment, SolvedMotionEvent, VerifiedMotionProgram } from "./types";
import { MOTION1D_ADAPTER_VERSION, MOTION1D_CAPABILITIES } from "./constants";

function refId(value: unknown, namespace: string, where: string): string {
  if (typeof value !== "string") throw makeRuntimeError("E_SCHEMA", `${where}: expected ${namespace}: reference`);
  const m = new RegExp(`^(?:math:)?${namespace}:([A-Za-z_][A-Za-z0-9_-]*)$`).exec(value);
  if (!m) throw makeRuntimeError("E_SCHEMA", `${where}: invalid math reference '${value}'`);
  return m[1];
}

function exactAtFact(fact: any, dimension: Dimension, where: string) {
  if (!fact) throw makeRuntimeError("E_BINDING", `${where}: missing referenced fact`);
  const raw = fromJson(fact.value, where);
  return normalize(raw, fact.unit, dimension, where);
}

function compileBodies(math: any, factById: Map<string, any>): MotionBodyProgram[] {
  const bodies: MotionBodyProgram[] = [];
  const entityIds = new Set<string>();
  for (const e of math.entities ?? []) {
    if (entityIds.has(e.id)) throw makeRuntimeError("E_SCHEMA", `duplicate motion entity '${e.id}'`);
    entityIds.add(e.id);
    if (e.kind !== "body") continue;
    const props = e.props ?? {};
    const rawSegments = props.segments;
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) throw makeRuntimeError("E_SCHEMA", `body '${e.id}' must declare at least one motion segment`);
    const expectedCapability = rawSegments.length === 1 ? "motion1d.constant_velocity" : "motion1d.piecewise_constant_velocity";
    if (props.capability_id !== expectedCapability) {
      throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `body '${e.id}' must use ${expectedCapability} for ${rawSegments.length} segment(s)`);
    }
    const initialFactId = refId(props.initial_position, "fact", `body '${e.id}'.initial_position`);
    const initialFact = factById.get(initialFactId);
    if (!initialFact) throw makeRuntimeError("E_BINDING", `body '${e.id}' references missing fact '${initialFactId}'`);
    const initialPosition = toExact(exactAtFact(initialFact, "distance", `body '${e.id}' initial_position`));
    const segments: MotionSegment[] = [];
    let prevEnd: ReturnType<typeof rat> | null = null;
    let prevPosition: ReturnType<typeof rat> | null = null;
    let prevStart: ReturnType<typeof rat> | null = null;
    let prevVelocity: ReturnType<typeof rat> | null = null;
    for (let i = 0; i < rawSegments.length; i++) {
      const raw = rawSegments[i];
      const where = `body '${e.id}' segment ${i}`;
      const startId = refId(raw.start, "fact", `${where}.start`);
      const velocityId = refId(raw.velocity, "fact", `${where}.velocity`);
      const startFact = factById.get(startId), velocityFact = factById.get(velocityId);
      if (!startFact || !velocityFact) throw makeRuntimeError("E_BINDING", `${where}: missing start or velocity source fact`);
      const start = exactAtFact(startFact, "time", `${where}.start`);
      const velocity = exactAtFact(velocityFact, "velocity", `${where}.velocity`);
      if (cmp(start, rat(0n)) < 0) throw makeRuntimeError("E_MATH_CONSTRAINT", `${where}: segment start must be non-negative`);
      if (prevStart && cmp(start, prevStart) <= 0) throw makeRuntimeError("E_SCHEMA", `${where}: starts must be strictly increasing in input order`);
      let end: ReturnType<typeof rat> | null = null;
      if (raw.end !== undefined && raw.end !== null) {
        const endFact = factById.get(refId(raw.end, "fact", `${where}.end`));
        if (!endFact) throw makeRuntimeError("E_BINDING", `${where}: missing end fact`);
        end = exactAtFact(endFact, "time", `${where}.end`);
        if (cmp(end, start) <= 0) throw makeRuntimeError("E_MATH_CONSTRAINT", `${where}: end must be greater than start`);
      }
      if (end === null && i !== rawSegments.length - 1) throw makeRuntimeError("E_SCHEMA", `${where}: an unbounded segment must be last`);
      if (i > 0) {
        if (!prevEnd) throw makeRuntimeError("E_SCHEMA", `${where}: preceding unbounded segment overlaps this segment`);
        if (cmp(start, prevEnd) < 0) throw makeRuntimeError("E_SCHEMA", `${where}: segment overlap`);
        if (cmp(start, prevEnd) > 0) throw makeRuntimeError("E_MATH_CONSTRAINT", `${where}: gaps are not allowed; segments must be contiguous`);
        if (!prevPosition) throw makeRuntimeError("E_SCHEMA", `${where}: preceding segment has no finite boundary position`);
      }
      const startPosition: ReturnType<typeof rat> = i === 0
        ? fromExact(initialPosition)
        : (() => {
            const dt = sub(start, prevStart!);
            if (!eq(dt, sub(prevEnd!, prevStart!))) throw makeRuntimeError("E_MATH_CONSTRAINT", `${where}: discontinuous segment boundary`);
            return prevPosition!;
          })();
      if (raw.start_position !== undefined) {
        const declaredFact = factById.get(refId(raw.start_position, "fact", `${where}.start_position`));
        const declared = exactAtFact(declaredFact, "distance", `${where}.start_position`);
        if (!eq(startPosition, declared)) throw makeRuntimeError("E_MATH_CONSTRAINT", `${where}: discontinuous start_position specification`);
      }
      segments.push({ start: toExact(start), end: end ? toExact(end) : null, startPosition: toExact(startPosition), velocity: toExact(velocity) });
      prevStart = start;
      prevEnd = end;
      prevVelocity = velocity;
      prevPosition = end ? add(startPosition, mul(velocity, sub(end, start))) : null;
    }
    bodies.push({ id: e.id, initialPosition, segments });
  }
  if (!bodies.length) throw makeRuntimeError("E_SCHEMA", "motion1d Math IR must contain at least one body entity");
  return bodies;
}

function compileEvents(math: any, bodies: MotionBodyProgram[], factById: Map<string, any>): SolvedMotionEvent[] {
  const bodyById = new Map(bodies.map((b) => [b.id, b]));
  const events: SolvedMotionEvent[] = [];
  const seen = new Set<string>();
  for (const raw of math.events ?? []) {
    if (seen.has(raw.event_id)) throw makeRuntimeError("E_SCHEMA", `duplicate event id '${raw.event_id}'`);
    seen.add(raw.event_id);
    const cap = raw.capability_id as MotionEventKind;
    if (cap !== "motion1d.meeting_event" && cap !== "motion1d.overtake_event" && cap !== "motion1d.reach_event") {
      throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `event '${raw.event_id}' has non-event capability '${cap}'`);
    }
    const participants: string[] = raw.participants ?? [];
    let event: SolvedMotionEvent;
    if (cap === "motion1d.meeting_event" || cap === "motion1d.overtake_event") {
      if (participants.length !== 2) throw makeRuntimeError("E_SCHEMA", `event '${raw.event_id}' requires exactly two body participants`);
      const ids = participants.map((x) => refId(x, "entity", `event '${raw.event_id}' participant`));
      const a = bodyById.get(ids[0]), b = bodyById.get(ids[1]);
      if (!a || !b) throw makeRuntimeError("E_BINDING", `event '${raw.event_id}' references a missing body`);
      event = solvePairEvent(raw.event_id, cap, a, b);
    } else {
      if (participants.length !== 2) throw makeRuntimeError("E_SCHEMA", `reach event '${raw.event_id}' requires body and target fact participants`);
      const bodyId = refId(participants[0], "entity", `event '${raw.event_id}' body`);
      const targetId = refId(participants[1], "fact", `event '${raw.event_id}' target`);
      const body = bodyById.get(bodyId), targetFact = factById.get(targetId);
      if (!body || !targetFact) throw makeRuntimeError("E_BINDING", `event '${raw.event_id}' references a missing body or target fact`);
      event = solveReachEvent(raw.event_id, cap, body, exactAtFact(targetFact, "distance", `event '${raw.event_id}' target`));
    }
    if (raw.at !== undefined && !eq(fromExact(event.time), fromJson(raw.at, `event '${raw.event_id}'.at`))) {
      throw makeRuntimeError("E_MATH_ASSERTION", `event '${raw.event_id}' declared time disagrees with exact solver (${event.time.p}/${event.time.q})`);
    }
    events.push(event);
  }
  return events;
}

function checkDerivedFacts(math: any, bodies: MotionBodyProgram[], events: SolvedMotionEvent[], factById: Map<string, any>): void {
  const bodyById = new Map(bodies.map((b) => [b.id, b]));
  for (const fact of math.derived_facts ?? []) {
    const provenance = fact.provenance ?? {};
    const capability = provenance.capability_id;
    const inputs: string[] = provenance.inputs ?? [];
    if (capability === "motion1d.unit_normalize") {
      const input = inputs.find((x) => /^(?:math:)?fact:/.test(x));
      const inputId = input ? refId(input, "fact", `derived '${fact.fact_id}' input`) : "";
      const source = factById.get(inputId);
      if (!source) throw makeRuntimeError("E_BINDING", `derived '${fact.fact_id}' normalization input missing`);
      const sourceDef = unitInfo(source.unit, `derived '${fact.fact_id}' input`);
      const expected = normalize(fromJson(source.value, `fact '${inputId}'`), source.unit, sourceDef.dimension, `derived '${fact.fact_id}'`);
      const targetDef = unitInfo(fact.unit, `derived '${fact.fact_id}' value`);
      if (targetDef.dimension !== sourceDef.dimension) throw makeRuntimeError("E_MATH_CONSTRAINT", `derived fact '${fact.fact_id}' has incompatible target unit`);
      const actual = exactAtFact(fact, sourceDef.dimension, `derived '${fact.fact_id}' value`);
      if (!eq(expected, actual)) throw makeRuntimeError("E_MATH_ASSERTION", `derived fact '${fact.fact_id}' does not match exact unit normalization`);
    } else if (capability === "motion1d.overtake_event" || capability === "motion1d.meeting_event" || capability === "motion1d.reach_event") {
      const entityIds = inputs.filter((x) => /^(?:math:)?entity:/.test(x)).map((x) => refId(x, "entity", `derived '${fact.fact_id}' input`));
      const event = events.find((x) => x.capabilityId === capability && x.participants.length === entityIds.length && x.participants.every((id) => entityIds.includes(id)));
      if (!event) throw makeRuntimeError("E_MATH_ASSERTION", `derived fact '${fact.fact_id}' has no matching solved ${capability}`);
      const expected = exactAtFact(fact, "time", `derived '${fact.fact_id}' value`);
      if (!eq(fromExact(event.time), expected)) throw makeRuntimeError("E_MATH_ASSERTION", `derived fact '${fact.fact_id}' time disagrees with solver: expected ${event.time.p}/${event.time.q}`);
    } else if (capability === "motion1d.solve_position") {
      const entityRef = inputs.find((x) => /^(?:math:)?entity:/.test(x));
      const timeRef = inputs.find((x) => /^(?:math:)?fact:/.test(x));
      if (!entityRef || !timeRef) throw makeRuntimeError("E_SCHEMA", `derived '${fact.fact_id}' solve_position inputs require body and time fact`);
      const body = bodyById.get(refId(entityRef, "entity", `derived '${fact.fact_id}' body`));
      const timeFact = factById.get(refId(timeRef, "fact", `derived '${fact.fact_id}' time`));
      if (!body || !timeFact) throw makeRuntimeError("E_BINDING", `derived '${fact.fact_id}' solve_position input missing`);
      const expected = positionOnBody(body, exactAtFact(timeFact, "time", `derived '${fact.fact_id}' time`));
      const actual = exactAtFact(fact, "distance", `derived '${fact.fact_id}' value`);
      if (!eq(expected, actual)) throw makeRuntimeError("E_MATH_ASSERTION", `derived fact '${fact.fact_id}' position disagrees with exact solver: expected ${expected.p}/${expected.q}`);
    }
  }
}

export function compileMotion(math: any): VerifiedMotionProgram {
  if (!math || math.domain !== "motion1d") throw makeRuntimeError("E_SCHEMA", "motion1d compiler requires math.domain='motion1d'");
  const used = new Set<string>();
  for (const c of math.capabilities ?? []) used.add(c);
  for (const e of math.entities ?? []) if (e.props?.capability_id) used.add(e.props.capability_id);
  for (const e of math.events ?? []) if (e.capability_id) used.add(e.capability_id);
  for (const f of math.derived_facts ?? []) if (f.provenance?.capability_id) used.add(f.provenance.capability_id);
  for (const c of used) {
    if (!MOTION1D_CAPABILITIES.has(c)) throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `motion1d adapter does not implement '${c}'`);
  }
  const facts = [...(math.source_facts ?? []), ...(math.derived_facts ?? [])];
  const factById = new Map(facts.map((f: any) => [f.fact_id, f]));
  const bodies = compileBodies(math, factById);
  const events = compileEvents(math, bodies, factById);
  checkDerivedFacts(math, bodies, events, factById);
  const assertions = (math.assertions ?? []).map((a: any) => ({
    assertionId: a.assertion_id,
    capabilityId: a.capability_id,
    subjects: (a.subject_refs ?? []).map((r: string) => refId(r, "entity", `assertion '${a.assertion_id}' subject`)),
    expectation: a.expectation ?? "holds",
    expected: toExact(fromJson(a.params?.expected ?? { kind: "int", value: "1" }, `assertion '${a.assertion_id}' expected`))
  }));
  const markers = (math.entities ?? []).filter((e: any) => e.kind === "event_marker").map((e: any) => {
    const eventId = typeof e.props?.event_id === "string" ? e.props.event_id : e.id;
    if (!events.some((event) => event.eventId === eventId)) throw makeRuntimeError("E_BINDING", `event marker '${e.id}' references missing solved event '${eventId}'`);
    return { id: e.id, eventId };
  });
  const programBase = { domain: "motion1d" as const, adapterVersion: MOTION1D_ADAPTER_VERSION, bodies, events, assertions, markers };
  return { ...programBase, digest: digestOf(programBase) };
}
