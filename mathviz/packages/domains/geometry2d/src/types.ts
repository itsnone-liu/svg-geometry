// geometry2d domain types — the P2 frozen program/snapshot shapes.
//
// Pipeline position: Math IR -> compile (ONCE) -> VerifiedGeometryProgram
// -> evaluate(ctx) (pure, per stateAt) -> GeometrySnapshot -> bindings.
//
// Nothing here knows about SVG, the DOM, wall clocks, or Geometry DSL types.

export interface Vec2 {
  x: number;
  y: number;
}

export type AngleSpec =
  | { type: "const"; value: number }
  | { type: "binding"; source: string };

export interface PointProg {
  id: string;
  kind: "point";
  x: number;
  y: number;
}

export interface SegmentProg {
  id: string;
  kind: "segment";
  a: string;
  b: string;
}

export interface LineProg {
  id: string;
  kind: "line";
  a: string;
  b: string;
}

export interface CircleProg {
  id: string;
  kind: "circle";
  center: string;
  radius: number;
}

export interface DynamicPointProg {
  id: string;
  kind: "dynamic_point";
  operation: "rotate_point" | "translate_point" | "reflect_point" | "midpoint" | "intersection_point" | "projection_point";
  capabilityId: string;
  center?: string;
  source?: string;
  a?: string;
  b?: string;
  angle?: AngleSpec;
  direction?: "cw" | "ccw";
  dx?: number;
  dy?: number;
  over?: string;
  first?: string;
  second?: string;
  selector?: number;
  point?: string;
  onto?: string;
}

export type GeometryEntityProgram = PointProg | SegmentProg | LineProg | CircleProg | DynamicPointProg;

export interface CompiledGeometryAssertion {
  assertion_id: string;
  capability: string;
  subjects: string[];
  params: Record<string, number>;
  expectation: "holds" | "forbidden";
}

export interface VerifiedGeometryProgram {
  domain: "geometry2d";
  adapterVersion: string;
  entities: GeometryEntityProgram[];
  constructions: DynamicPointProg[];
  assertions: CompiledGeometryAssertion[];
  dependencyOrder: string[];
  digest: string;
}

export type GeometrySnapshotEntity =
  | { kind: "point"; position: Vec2 }
  | { kind: "segment" | "line"; a: Vec2; b: Vec2 }
  | { kind: "circle"; center: Vec2; radius: number };

export interface GeometrySnapshot {
  modelTime: number | null;
  entities: Record<string, GeometrySnapshotEntity>;
  digest: string;
}
