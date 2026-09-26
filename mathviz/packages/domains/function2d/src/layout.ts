// P4 §20 semantic layout rule (frozen): every function2d scene carries
// EXACTLY ONE cartesian_window layout rule with finite, ordered bounds.
// Missing / duplicate / malformed -> E_LAYOUT. This is a SEMANTIC gate —
// the Scene v1 outer schema is untouched (layoutRules stays open there).
//
// The renderer independently reads the window for world->pixel mapping
// (presentation); THIS module is the freeze-time gate.

import { makeRuntimeError } from "../../../runtime/src/errors";

export interface CartesianWindow {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function parseWindowRule(rule: any): CartesianWindow | null {
  if (!rule || typeof rule !== "object" || rule.kind !== "cartesian_window") return null;
  const { x_min, x_max, y_min, y_max } = rule;
  const nums = [x_min, x_max, y_min, y_max];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  if (!(x_max > x_min && y_max > y_min)) return null;
  return { xMin: x_min, xMax: x_max, yMin: y_min, yMax: y_max };
}

/** Gate: throws VizRuntimeError(E_LAYOUT) unless the scene has exactly one
 *  well-formed cartesian_window. */
export function checkCartesianWindow(scene: any): CartesianWindow {
  const rules = Array.isArray(scene?.layoutRules) ? scene.layoutRules : [];
  const windows = rules.map(parseWindowRule);
  const declared = rules.filter((r: any) => r?.kind === "cartesian_window").length;
  if (declared === 0) {
    throw makeRuntimeError("E_LAYOUT", "function2d scene requires exactly one cartesian_window layout rule (found none)");
  }
  if (declared > 1) {
    throw makeRuntimeError("E_LAYOUT", `function2d scene requires exactly one cartesian_window layout rule (found ${declared})`);
  }
  const w = windows.find((x: CartesianWindow | null) => x !== null);
  if (!w) {
    throw makeRuntimeError("E_LAYOUT", "cartesian_window bounds must be finite with x_max > x_min and y_max > y_min");
  }
  return w;
}
