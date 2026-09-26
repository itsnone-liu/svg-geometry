// Math IR -> VerifiedGeometryProgram compiler (runs ONCE at load).
//
// Compile-time work (G4): reference resolution, dependency graph + cycle
// detection, capability support check, static construction validation,
// expression compilation. The per-frame path only EXECUTES the result.

import { makeRuntimeError } from "../../../runtime/src/errors";
import { evalExpr } from "../../../runtime/src/expr/evaluate";
import { digestOf } from "../../../runtime/src/digest";
import {
  AngleSpec,
  CompiledGeometryAssertion,
  DynamicPointProg,
  GeometryEntityProgram,
  VerifiedGeometryProgram
} from "./types";
import { GEOMETRY2D_ADAPTER_VERSION as ADAPTER_VERSION, P2_CAPABILITIES } from "./constants";
import { parseExactString } from "./exact-string";

const OPERATION_BY_CAPABILITY: Record<string, DynamicPointProg["operation"]> = {
  "geometry2d.rotate_point": "rotate_point",
  "geometry2d.translate_point": "translate_point",
  "geometry2d.reflect_point": "reflect_point",
  "geometry2d.midpoint": "midpoint",
  "geometry2d.intersection_point": "intersection_point",
  "geometry2d.projection_point": "projection_point"
};

const PREDICATE_CAPABILITIES = new Set([
  "geometry2d.parallel",
  "geometry2d.perpendicular",
  "geometry2d.equal_length",
  "geometry2d.collinear",
  "geometry2d.on_circle",
  "geometry2d.distance_equal",
  "geometry2d.angle_mark"
]);

const ENTITY_KIND_CAPABILITY: Record<string, string> = {
  point: "geometry2d.point",
  segment: "geometry2d.segment",
  line: "geometry2d.line",
  circle: "geometry2d.circle",
  dynamic_point: "" // per-construction capability_id in props
};

function err(code: any, msg: string): never {
  throw makeRuntimeError(code, msg);
}

/** Evaluate a static coordinate: number | ExactNumber | ExprAst | exact
 *  string ("sqrt(2)/2") -> double. Numericization happens HERE (domain
 *  layer), never back into Math IR. */
function evalConst(v: any, what: string): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) err("E_SCHEMA", `${what}: non-finite number`);
    return v;
  }
  if (typeof v === "string") {
    const ast = parseExactString(v);
    const r = evalExpr(ast, {});
    return r.kind === "exact" ? Number((r as any).r.p) / Number((r as any).r.q) : (r as any).v;
  }
  if (v && typeof v === "object" && (v.t === "num" || v.t === "app" || v.t === "sym")) {
    if (usesT(v)) err("E_SCHEMA", `${what}: static value must not reference model time 't' — declare a dynamic_point and bind runtime:... instead`);
    const r = evalExpr(v, {});
    return r.kind === "exact" ? Number((r as any).r.p) / Number((r as any).r.q) : (r as any).v;
  }
  if (v && typeof v === "object" && (v.kind === "int" || v.kind === "rational" || v.kind === "decimal")) {
    if (v.kind === "int") return Number(v.value);
    if (v.kind === "rational") return Number(v.p) / Number(v.q);
    err("E_SCHEMA", `${what}: decimal literals not supported here`);
  }
  err("E_SCHEMA", `${what}: unsupported coordinate value`);
}

/** Subject refs may be bare ids or 'entity:ID' prefixed (P0 fixture style). */
function normalizeSubjectRef(s: any): string {
  if (typeof s !== "string") return s;
  return s.startsWith("entity:") ? s.slice("entity:".length) : s;
}

function needEntityRef(props: any, key: string, who: string, byId: Map<string, any>): string {
  const ref = normalizeSubjectRef(props?.[key]);
  if (typeof ref !== "string" || !byId.has(ref)) err("E_BINDING", `${who}: props.${key} references missing entity '${props?.[key]}'`);
  return ref;
}

function usesT(ast: any): boolean {
  if (!ast || typeof ast !== "object") return false;
  if (ast.t === "sym") return ast.name === "t";
  if (ast.t === "app") return (ast.args ?? []).some(usesT);
  if (ast.t === "num" && ast.v?.kind === "symbolic") return usesT(ast.v.expr);
  return false;
}

function compileAngle(v: any, what: string): AngleSpec {
  if (typeof v === "string" && v.startsWith("math:")) {
    if (!v.startsWith("math:runtime:")) {
      err("E_SCHEMA", `${what}: dynamic angle must reference a runtime value (math:runtime:...), got '${v}'`);
    }
    return { type: "binding", source: v };
  }
  return { type: "const", value: evalConst(v, what) };
}

export function compileGeometry(math: any): VerifiedGeometryProgram {
  const entitiesIn: any[] = math?.entities ?? [];
  const byId = new Map<string, any>();
  for (const e of entitiesIn) {
    if (typeof e?.id !== "string" || e.id.length === 0) err("E_SCHEMA", "geometry entity without id");
    if (byId.has(e.id)) err("E_SCHEMA", `duplicate geometry entity id '${e.id}'`);
    byId.set(e.id, e);
  }

  const pointIds = new Set<string>();
  const carrierIds = new Set<string>(); // segment | line
  const entities: GeometryEntityProgram[] = [];

  // ---- pass 1: static entities + shapes ----
  for (const e of entitiesIn) {
    const props = e.props ?? {};
    switch (e.kind) {
      case "point": {
        const p: GeometryEntityProgram = { id: e.id, kind: "point", x: evalConst(props.x, `entity '${e.id}'.props.x`), y: evalConst(props.y, `entity '${e.id}'.props.y`) };
        entities.push(p);
        pointIds.add(e.id);
        break;
      }
      case "segment":
      case "line": {
        const aRef = needEntityRef(props, "a", `entity '${e.id}'`, byId);
        const bRef = needEntityRef(props, "b", `entity '${e.id}'`, byId);
        entities.push(e.kind === "segment" ? { id: e.id, kind: "segment", a: aRef, b: bRef } : { id: e.id, kind: "line", a: aRef, b: bRef });
        carrierIds.add(e.id);
        break;
      }
      case "circle": {
        const cRef = needEntityRef(props, "center", `entity '${e.id}'`, byId);
        const radius = evalConst(props.radius, `entity '${e.id}'.props.radius`);
        if (!(radius > 0)) err("E_MATH_CONSTRAINT", `entity '${e.id}': circle radius must be > 0`);
        entities.push({ id: e.id, kind: "circle", center: cRef, radius });
        break;
      }
      case "dynamic_point":
        break; // pass 2
      default:
        err("E_SCHEMA", `entity '${e.id}': unsupported geometry kind '${e.kind}' (P2 supports point/segment/line/circle/dynamic_point)`);
    }
  }

  // ---- pass 2: dynamic points (constructions) ----
  const constructions: DynamicPointProg[] = [];
  for (const e of entitiesIn) {
    if (e.kind !== "dynamic_point") continue;
    const props = e.props ?? {};
    const capId = props.capability_id;
    const operation = OPERATION_BY_CAPABILITY[capId];
    if (!operation) {
      if (typeof capId === "string" && capId.startsWith("geometry2d.")) {
        err("E_CAPABILITY_UNSUPPORTED", `entity '${e.id}': capability '${capId}' exists in the registry but is NOT implemented by the P2 geometry2d adapter`);
      }
      err("E_CAPABILITY_UNSUPPORTED", `entity '${e.id}': unknown construction capability '${capId}'`);
    }
    if (!P2_CAPABILITIES.has(capId)) err("E_CAPABILITY_UNSUPPORTED", `entity '${e.id}': capability '${capId}' not in the P2 frozen set`);

    const d: DynamicPointProg = { id: e.id, kind: "dynamic_point", operation, capabilityId: capId };
    const needPoint = (k: string): string => needEntityRef(props, k, `entity '${e.id}'`, byId);
    switch (operation) {
      case "rotate_point":
        d.center = needPoint("center");
        d.source = needPoint("source");
        d.angle = compileAngle(props.angle, `entity '${e.id}'.props.angle`);
        d.direction = props.direction === "cw" ? "cw" : "ccw";
        break;
      case "translate_point":
        d.source = needPoint("source");
        d.dx = evalConst(props.dx ?? 0, `entity '${e.id}'.props.dx`);
        d.dy = evalConst(props.dy ?? 0, `entity '${e.id}'.props.dy`);
        break;
      case "reflect_point":
        d.source = needPoint("source");
        d.over = needPoint("over");
        break;
      case "midpoint":
        d.a = needPoint("a");
        d.b = needPoint("b");
        break;
      case "intersection_point":
        d.first = needPoint("first");
        d.second = needPoint("second");
        d.selector = typeof props.selector === "number" ? props.selector : 0;
        break;
      case "projection_point":
        d.point = needPoint("point");
        d.onto = needPoint("onto");
        break;
    }
    constructions.push(d);
  }

  // ---- assertions ----
  const assertions: CompiledGeometryAssertion[] = [];
  for (const [assertIndex, a] of [...(math?.constraints ?? []), ...(math?.assertions ?? [])].entries()) {
    const cap = a?.capability_id;
    if (!PREDICATE_CAPABILITIES.has(cap)) {
      // non-predicate capabilities in constraints are not runtime-assertable in P2
      continue;
    }
    const subjects: string[] = (a.subjects ?? a.subject_refs ?? []).map((s: any) => {
      const norm = normalizeSubjectRef(s);
      if (typeof norm !== "string" || !byId.has(norm)) err("E_BINDING", `assertion '${a.assertion_id ?? a.constraint_id}': subject '${s}' is not a declared entity`);
      return norm;
    });
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(a.params ?? {})) params[k] = evalConst(v, `assertion '${a.assertion_id ?? a.constraint_id}'.params.${k}`);
    assertions.push({
      assertion_id: a.assertion_id ?? a.constraint_id ?? `geometry_assertion_${assertIndex}`,
      capability: cap,
      subjects,
      params,
      expectation: a.expectation === "forbidden" ? "forbidden" : "holds"
    });
  }

  // ---- dependency graph: topo order + cycle detection ----
  const deps = new Map<string, string[]>();
  for (const e of entities) {
    if (e.kind === "segment" || e.kind === "line") deps.set(e.id, [e.a, e.b]);
    else if (e.kind === "circle") deps.set(e.id, [e.center]);
  }
  for (const d of constructions) {
    deps.set(d.id, [d.center, d.source, d.a, d.b, d.over, d.first, d.second, d.point, d.onto].filter((x): x is string => typeof x === "string"));
  }
  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 1=visiting 2=done
  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) err("E_SCHEMA", `geometry dependency cycle through entity '${id}'`);
    state.set(id, 1);
    for (const dep of deps.get(id) ?? []) if (byId.has(dep)) visit(dep);
    state.set(id, 2);
    order.push(id);
  };
  for (const e of entitiesIn) visit(e.id);

  // static shape endpoints must be points (validated up front for fast failure)
  for (const e of entities) {
    if (e.kind === "segment" || e.kind === "line") {
      for (const ref of [e.a, e.b]) {
        const target = byId.get(ref);
        if (target && target.kind !== "point" && target.kind !== "dynamic_point") {
          err("E_BINDING", `entity '${e.id}': endpoint '${ref}' must be a point entity (got '${target.kind}')`);
        }
      }
    }
    if (e.kind === "circle") {
      const target = byId.get(e.center);
      if (target && target.kind !== "point" && target.kind !== "dynamic_point") {
        err("E_BINDING", `entity '${e.id}': center '${e.center}' must be a point entity (got '${target.kind}')`);
      }
    }
  }
  for (const d of constructions) {
    const pointRefs = [d.center, d.source, d.a, d.b, d.point].filter((x): x is string => typeof x === "string");
    for (const ref of pointRefs) {
      const target = byId.get(ref);
      if (target && target.kind !== "point" && target.kind !== "dynamic_point") {
        err("E_BINDING", `construction '${d.id}': operand '${ref}' must be a point entity (got '${target.kind}')`);
      }
    }
    for (const ref of [d.over, d.onto, d.first, d.second].filter((x): x is string => typeof x === "string")) {
      const target = byId.get(ref);
      if (target && target.kind !== "segment" && target.kind !== "line" && target.kind !== "dynamic_point") {
        err("E_BINDING", `construction '${d.id}': carrier '${ref}' must be a segment/line entity (got '${target.kind}')`);
      }
    }
  }

  const program: Omit<VerifiedGeometryProgram, "digest"> = {
    domain: "geometry2d",
    adapterVersion: ADAPTER_VERSION,
    entities,
    constructions,
    assertions,
    dependencyOrder: order
  };
  return { ...program, digest: digestOf(program) };
}
