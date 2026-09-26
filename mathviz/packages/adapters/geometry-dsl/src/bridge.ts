// Bridge: MathViz geometry values -> upstream Geometry DSL kernel values.
//
// The upstream kernel speaks its own value types (PointValue/LineValue/
// CircleValue). They are constructed HERE and die HERE — none of these
// types cross into MathViz core (isolation rule, P2 §3).

import {
  add,
  barePoint,
  intersections,
  lerp,
  projectPoint,
  rotate,
  sub
} from "../vendor/geometry-dsl/src/geometry/index";
import type { Vec2 } from "../../../domains/geometry2d/src/types";
import { makeRuntimeError } from "../../../runtime/src/errors";

const HIDDEN_LINE_STYLE = {
  visible: false,
  color: "black",
  width: 1,
  dashed: false,
  opacity: 1,
  layer: 0,
  arrow: null
};

function lineValue(a: Vec2, b: Vec2): any {
  return {
    type: "Line",
    a: barePoint(a.x, a.y),
    b: barePoint(b.x, b.y),
    kind: "segment",
    objectId: null,
    created: null,
    style: HIDDEN_LINE_STYLE
  };
}

export const bridge = {
  midpoint(a: Vec2, b: Vec2): Vec2 {
    const v = lerp(barePoint(a.x, a.y), barePoint(b.x, b.y), 0.5);
    return { x: v.x, y: v.y };
  },
  rotateAround(p: Vec2, center: Vec2, signedRadians: number): Vec2 {
    const v = add(barePoint(center.x, center.y), rotate(sub({ x: p.x, y: p.y }, { x: center.x, y: center.y }), signedRadians));
    return { x: v.x, y: v.y };
  },
  intersection(segA: { a: Vec2; b: Vec2 }, segB: { a: Vec2; b: Vec2 }): Vec2 {
    const hits = intersections(lineValue(segA.a, segA.b), lineValue(segB.a, segB.b));
    if (hits.length === 0) throw makeRuntimeError("E_MATH_CONSTRAINT", "oracle: no intersection");
    if (hits.length > 1) throw makeRuntimeError("E_MATH_CONSTRAINT", "oracle: intersection not unique");
    const h = hits[0]!;
    return { x: h.x, y: h.y };
  },
  projection(p: Vec2, onto: { a: Vec2; b: Vec2 }): Vec2 {
    const v = projectPoint(barePoint(p.x, p.y), lineValue(onto.a, onto.b));
    return { x: v.x, y: v.y };
  }
};
