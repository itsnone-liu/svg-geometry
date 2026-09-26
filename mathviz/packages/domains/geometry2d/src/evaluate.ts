// Pure per-state evaluation of a VerifiedGeometryProgram.
// Executes constructions in frozen dependency order; numeric doubles only
// (exact rationals were resolved to doubles at compile — the domain layer
// is the ONLY place numericization happens).

import { makeRuntimeError } from "../../../runtime/src/errors";
import { digestOf } from "../../../runtime/src/digest";
import type { DomainEvaluationContext } from "../../../runtime/src/domain";
import {
  GeometryEntityProgram,
  GeometrySnapshot,
  GeometrySnapshotEntity,
  VerifiedGeometryProgram
} from "./types";
import * as ops from "./constructions/ops";

function pointOf(entities: Record<string, GeometrySnapshotEntity>, id: string | undefined, who: string): { x: number; y: number } {
  const e = id !== undefined ? entities[id] : undefined;
  if (!e || e.kind !== "point") {
    throw makeRuntimeError("E_BINDING", `${who}: operand '${id}' is not a resolved point`);
  }
  return e.position;
}

function carrierOf(entities: Record<string, GeometrySnapshotEntity>, id: string | undefined, who: string): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const e = id !== undefined ? entities[id] : undefined;
  if (!e || (e.kind !== "segment" && e.kind !== "line")) {
    throw makeRuntimeError("E_BINDING", `${who}: operand '${id}' is not a resolved segment/line`);
  }
  return e;
}

export function evaluateGeometry(program: VerifiedGeometryProgram, ctx: DomainEvaluationContext): GeometrySnapshot {
  const entities: Record<string, GeometrySnapshotEntity> = {};

  const resolveAngle = (spec: { type: "const"; value: number } | { type: "binding"; source: string } | undefined, who: string): number => {
    if (!spec) return 0;
    if (spec.type === "const") return spec.value;
    const v = ctx.resolveBinding(spec.source);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw makeRuntimeError(
        "E_MATH_CONSTRAINT",
        `${who}: dynamic angle binding '${spec.source}' resolved to ${v === null ? "null (no model time at this presentation time — map the full duration or extend the mapping window)" : typeof v} — dynamic constructions need a resolvable model-time-driven value`
      );
    }
    return v;
  };

  const byId = new Map<string, GeometryEntityProgram>(program.entities.map((e) => [e.id, e]));
  for (const c of program.constructions) byId.set(c.id, c);

  // Single pass in the frozen dependency order — static shapes and dynamic
  // constructions interleave (a static circle may depend on a constructed
  // midpoint), which is exactly what the topological sort guarantees.
  for (const id of program.dependencyOrder) {
    const e = byId.get(id);
    if (!e) continue;
    switch (e.kind) {
      case "point":
        entities[id] = { kind: "point", position: { x: e.x, y: e.y } };
        break;
      case "segment":
      case "line":
        entities[id] = { kind: e.kind, a: pointOf(entities, e.a, `entity '${id}'`), b: pointOf(entities, e.b, `entity '${id}'`) };
        break;
      case "circle":
        entities[id] = { kind: "circle", center: pointOf(entities, e.center, `entity '${id}'`), radius: e.radius };
        break;
      case "dynamic_point": {
        const d = e;
        switch (d.operation) {
          case "rotate_point": {
            const center = pointOf(entities, d.center, `construction '${d.id}'`);
            const source = pointOf(entities, d.source, `construction '${d.id}'`);
            let angle = resolveAngle(d.angle, `construction '${d.id}'`);
            if (d.direction === "cw") angle = -angle; // CCW-positive convention (frozen)
            entities[d.id] = { kind: "point", position: ops.rotateAround(source, center, angle) };
            break;
          }
          case "translate_point": {
            const source = pointOf(entities, d.source, `construction '${d.id}'`);
            entities[d.id] = { kind: "point", position: ops.translate(source, d.dx ?? 0, d.dy ?? 0) };
            break;
          }
          case "reflect_point": {
            const source = pointOf(entities, d.source, `construction '${d.id}'`);
            const c = carrierOf(entities, d.over, `construction '${d.id}'`);
            entities[d.id] = { kind: "point", position: ops.reflectAcross(source, c.a, c.b) };
            break;
          }
          case "midpoint": {
            const a = pointOf(entities, d.a, `construction '${d.id}'`);
            const b = pointOf(entities, d.b, `construction '${d.id}'`);
            entities[d.id] = { kind: "point", position: ops.midpoint(a, b) };
            break;
          }
          case "intersection_point": {
            const c1 = carrierOf(entities, d.first, `construction '${d.id}'`);
            const c2 = carrierOf(entities, d.second, `construction '${d.id}'`);
            entities[d.id] = { kind: "point", position: ops.intersectLines(c1.a, c1.b, c2.a, c2.b) };
            break;
          }
          case "projection_point": {
            const p = pointOf(entities, d.point, `construction '${d.id}'`);
            const c = carrierOf(entities, d.onto, `construction '${d.id}'`);
            entities[d.id] = { kind: "point", position: ops.projectOntoLine(p, c.a, c.b) };
            break;
          }
        }
        break;
      }
    }
  }

  const partial = { modelTime: ctx.modelTime, entities };
  return { ...partial, digest: digestOf(partial) };
}
