// Construction math — MathViz's OWN implementation.
//
// G11 independence rule: these helpers share NOTHING with the pinned
// Geometry DSL upstream (vendor/). The oracle gate compares the two
// implementations; calling the same helper on both sides would make the
// cross-check meaningless.

import { Vec2 } from "../types";
import { GEOMETRY_EPS } from "../constants";

export function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
export function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function scale(a: Vec2, s: number): Vec2 { return { x: a.x * s, y: a.y * s }; }
export function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
export function cross(a: Vec2, b: Vec2): number { return a.x * b.y - a.y * b.x; }
export function norm(a: Vec2): number { return Math.hypot(a.x, a.y); }
export function dist(a: Vec2, b: Vec2): number { return norm(sub(a, b)); }

/** Rotate `p` around `c` by signed radians (positive = CCW, standard math). */
export function rotateAround(p: Vec2, c: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const d = sub(p, c);
  return {
    x: c.x + d.x * cos - d.y * sin,
    y: c.y + d.x * sin + d.y * cos
  };
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function translate(p: Vec2, dx: number, dy: number): Vec2 {
  return { x: p.x + dx, y: p.y + dy };
}

/** Reflect `p` across the line through `a` and `b`. */
export function reflectAcross(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 <= GEOMETRY_EPS * GEOMETRY_EPS) {
    const err = new Error("degenerate line (a == b)");
    (err as any).code = "E_MATH_CONSTRAINT";
    throw err;
  }
  const t = dot(sub(p, a), ab) / len2;
  const foot = add(a, scale(ab, t));
  return add(scale(foot, 2), scale(p, -1));
}

/** Orthogonal projection of `p` onto the (infinite) line through a,b. */
export function projectOntoLine(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 <= GEOMETRY_EPS * GEOMETRY_EPS) {
    const err = new Error("degenerate line (a == b)");
    (err as any).code = "E_MATH_CONSTRAINT";
    throw err;
  }
  const t = dot(sub(p, a), ab) / len2;
  return add(a, scale(ab, t));
}

/** Unique intersection of the lines through (a1,b1) and (a2,b2).
 *  Parallel/degenerate -> E_MATH_CONSTRAINT; coincident -> E_MATH_CONSTRAINT. */
export function intersectLines(a1: Vec2, b1: Vec2, a2: Vec2, b2: Vec2): Vec2 {
  const d1 = sub(b1, a1);
  const d2 = sub(b2, a2);
  const den = cross(d1, d2);
  const scaleRef = Math.max(norm(d1), norm(d2), 1);
  if (Math.abs(den) <= GEOMETRY_EPS * scaleRef * Math.max(norm(d1) * norm(d2), 1)) {
    const err = new Error(Math.abs(cross(sub(a2, a1), d1)) <= GEOMETRY_EPS * norm(d1) * norm(d2)
      ? "coincident lines: intersection not unique"
      : "parallel lines: no intersection");
    (err as any).code = "E_MATH_CONSTRAINT";
    throw err;
  }
  const t = cross(sub(a2, a1), d2) / den;
  return add(a1, scale(d1, t));
}

/** Angle (radians, [0, pi]) at `v` between rays to `a` and `b`. */
export function angleAt(a: Vec2, v: Vec2, b: Vec2): number {
  const u1 = sub(a, v);
  const u2 = sub(b, v);
  const c = dot(u1, u2) / (norm(u1) * norm(u2));
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

/** Segment/line carrier endpoints from a snapshot entity. */
export function carriers(e: { a?: Vec2; b?: Vec2 }): { a: Vec2; b: Vec2 } {
  if (!e?.a || !e?.b) {
    const err = new Error("entity is not a segment/line carrier");
    (err as any).code = "E_BINDING";
    throw err;
  }
  return { a: e.a, b: e.b };
}
