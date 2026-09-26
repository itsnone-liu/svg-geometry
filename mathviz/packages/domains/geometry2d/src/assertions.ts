// Geometry predicates (G5). ONE numeric policy for every predicate:
//   GEOMETRY_EPS = 1e-9 — normalized comparisons (dot/cross against the
//   product of operand norms), so tolerance is scale-free. No private
//   epsilons anywhere in the domain.

import { makeRuntimeError } from "../../../runtime/src/errors";
import type { AssertionOutcome, DomainSnapshot } from "../../../runtime/src/domain";
import type { CompiledGeometryAssertion, GeometrySnapshotEntity, VerifiedGeometryProgram } from "./types";
import * as ops from "./constructions/ops";
import { GEOMETRY_EPS } from "./constants";

type Entities = Record<string, GeometrySnapshotEntity>;

function pt(entities: Entities, id: string): { x: number; y: number } {
  const e = entities[id];
  if (!e || e.kind !== "point") throw makeRuntimeError("E_BINDING", `predicate subject '${id}' is not a point`);
  return e.position;
}

function carrier(entities: Entities, id: string): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const e = entities[id];
  if (!e || (e.kind !== "segment" && e.kind !== "line")) throw makeRuntimeError("E_BINDING", `predicate subject '${id}' is not a segment/line`);
  return e;
}

function toSubjectPoints(entities: Entities, subjects: string[]): { x: number; y: number }[] {
  return subjects.map((s) => {
    const e = entities[s];
    if (e?.kind === "point") return e.position;
    if (e?.kind === "segment" || e?.kind === "line") return e.a; // carriers: first endpoint
    throw makeRuntimeError("E_BINDING", `predicate subject '${s}' has unsupported kind '${e?.kind}'`);
  });
}

function segPair(entities: Entities, subjects: string[]): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  if (subjects.length === 4) {
    const [a, b, c, d] = subjects.map((s) => pt(entities, s));
    return [a, b, c, d];
  }
  if (subjects.length === 2) {
    const s1 = carrier(entities, subjects[0]);
    const s2 = carrier(entities, subjects[1]);
    return [s1.a, s1.b, s2.a, s2.b];
  }
  throw makeRuntimeError("E_SCHEMA", `equal_length/parallel need 2 segment subjects or 4 point subjects (got ${subjects.length})`);
}

function evaluateAssertion(entities: Entities, a: CompiledGeometryAssertion): AssertionOutcome {
  const base = { assertion_id: a.assertion_id, capability: a.capability, subjects: a.subjects, expectation: a.expectation };
  let pass = false;
  let detail = "";
  switch (a.capability) {
    case "geometry2d.perpendicular": {
      if (a.subjects.length !== 3) throw makeRuntimeError("E_SCHEMA", `perpendicular needs 3 subjects (vertex = 2nd), got ${a.subjects.length}`);
      const [p1, p2, p3] = toSubjectPoints(entities, a.subjects);
      const u = ops.sub(p1, p2);
      const v = ops.sub(p3, p2);
      const d = Math.abs(ops.dot(u, v));
      const ref = ops.norm(u) * ops.norm(v);
      pass = ref === 0 ? false : d <= GEOMETRY_EPS * ref;
      detail = `|dot|=${d.toPrecision(12)} vs eps*|u||v|=${(GEOMETRY_EPS * ref).toPrecision(12)}`;
      break;
    }
    case "geometry2d.collinear": {
      if (a.subjects.length !== 3) throw makeRuntimeError("E_SCHEMA", `collinear needs 3 subjects, got ${a.subjects.length}`);
      const [p1, p2, p3] = toSubjectPoints(entities, a.subjects);
      const u = ops.sub(p1, p2);
      const v = ops.sub(p3, p2);
      const c = Math.abs(ops.cross(u, v));
      const ref = ops.norm(u) * ops.norm(v);
      pass = c <= GEOMETRY_EPS * ref;
      detail = `|cross|=${c.toPrecision(12)} vs eps*|u||v|=${(GEOMETRY_EPS * ref).toPrecision(12)}`;
      break;
    }
    case "geometry2d.parallel": {
      const [a1, b1, a2, b2] = segPair(entities, a.subjects);
      const u = ops.sub(b1, a1);
      const v = ops.sub(b2, a2);
      const c = Math.abs(ops.cross(u, v));
      pass = c <= GEOMETRY_EPS * ops.norm(u) * ops.norm(v);
      detail = `|cross|=${c.toPrecision(12)}`;
      break;
    }
    case "geometry2d.equal_length": {
      const [a1, b1, a2, b2] = segPair(entities, a.subjects);
      const l1 = ops.dist(a1, b1);
      const l2 = ops.dist(a2, b2);
      pass = Math.abs(l1 - l2) <= GEOMETRY_EPS * Math.max(1, l1, l2);
      detail = `|l1-l2|=${Math.abs(l1 - l2).toPrecision(12)}`;
      break;
    }
    case "geometry2d.distance_equal": {
      if (a.subjects.length !== 2) throw makeRuntimeError("E_SCHEMA", `distance_equal needs 2 point subjects, got ${a.subjects.length}`);
      const [p1, p2] = a.subjects.map((s) => pt(entities, s));
      const l = ops.dist(p1, p2);
      const target = a.params.value;
      if (target === undefined) throw makeRuntimeError("E_SCHEMA", `distance_equal needs params.value`);
      pass = Math.abs(l - target) <= GEOMETRY_EPS * Math.max(1, l, target);
      detail = `|len-target|=${Math.abs(l - target).toPrecision(12)}`;
      break;
    }
    case "geometry2d.on_circle": {
      if (a.subjects.length !== 2) throw makeRuntimeError("E_SCHEMA", `on_circle needs (point, circle), got ${a.subjects.length}`);
      const p = pt(entities, a.subjects[0]);
      const c = entities[a.subjects[1]];
      if (!c || c.kind !== "circle") throw makeRuntimeError("E_BINDING", `on_circle second subject '${a.subjects[1]}' is not a circle`);
      const d = Math.abs(ops.dist(p, c.center) - c.radius);
      pass = d <= GEOMETRY_EPS * Math.max(1, c.radius);
      detail = `|dist-r|=${d.toPrecision(12)}`;
      break;
    }
    case "geometry2d.angle_mark": {
      if (a.subjects.length !== 3) throw makeRuntimeError("E_SCHEMA", `angle_mark needs 3 subjects (vertex = 2nd), got ${a.subjects.length}`);
      const [p1, p2, p3] = toSubjectPoints(entities, a.subjects);
      const angle = ops.angleAt(p1, p2, p3);
      const expected = (a.params.value * Math.PI) / 180;
      pass = Math.abs(angle - expected) <= GEOMETRY_EPS;
      detail = `angle=${(angle * 180 / Math.PI).toPrecision(12)}deg vs expected ${a.params.value}deg`;
      break;
    }
    default:
      throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `predicate '${a.capability}' not implemented by the P2 adapter`);
  }
  return { ...base, pass, detail };
}

export function assertGeometry(program: VerifiedGeometryProgram, snapshot: DomainSnapshot): AssertionOutcome[] {
  const entities = (snapshot as any).entities as Entities;
  return program.assertions.map((a) => evaluateAssertion(entities, a));
}
