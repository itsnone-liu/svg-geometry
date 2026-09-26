// Deterministic curve sampling (P4 §17–18).
//
// Frozen policy: FUNCTION_SAMPLE_COUNT points x_i = xMin + i/(N-1)*(xMax-xMin),
// i = 0..N-1, each computed INDEPENDENTLY from the expression — no recursion
// from the previous point, no adaptive/random points, no DOM influence.
// A sample that throws (division by zero, domain error) or is non-finite
// becomes a BREAK: the polyline splits there. No asymptote guessing.

import { evalExpr, ExprAst, Env } from "../../../runtime/src/expr/evaluate";
import { ratToNumber } from "../../../runtime/src/expr/exact";
import type { Rat } from "../../../runtime/src/expr/exact";
import type { CompiledFunction } from "./types";
import { FUNCTION_SAMPLE_COUNT } from "./constants";

export interface SampledCurve {
  segments: Array<Array<{ x: number; y: number }>>;
  breakCount: number;
}

function evalToNumber(ast: ExprAst, env: Env): number {
  const v = evalExpr(ast, env);
  return v.kind === "exact" ? ratToNumber(v.r as Rat) : v.v;
}

export function sampleFunction(
  fn: CompiledFunction,
  parameterValues: Record<string, number>,
  sampleCount: number = FUNCTION_SAMPLE_COUNT
): SampledCurve {
  const n = Math.max(2, Math.floor(sampleCount));
  const xMin = ratToNumber({ p: BigInt(fn.xMin.p), q: BigInt(fn.xMin.q) });
  const xMax = ratToNumber({ p: BigInt(fn.xMax.p), q: BigInt(fn.xMax.q) });
  const span = xMax - xMin;
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  let breakCount = 0;

  for (let i = 0; i < n; i++) {
    // frozen formula — identical arithmetic in Node and the browser
    const x = xMin + (i / (n - 1)) * span;
    let y: number;
    try {
      const env: Env = {};
      for (const [k, v] of Object.entries(parameterValues)) env[k] = { kind: "num", v };
      env[fn.variable] = { kind: "num", v: x };
      y = evalToNumber(fn.expr, env);
    } catch {
      // domain error (E_MATH_CONSTRAINT from the evaluator): break
      if (current.length > 0) segments.push(current);
      current = [];
      breakCount++;
      continue;
    }
    if (!Number.isFinite(y)) {
      if (current.length > 0) segments.push(current);
      current = [];
      breakCount++;
      continue;
    }
    current.push({ x, y });
  }
  if (current.length > 0) segments.push(current);
  return { segments, breakCount };
}
