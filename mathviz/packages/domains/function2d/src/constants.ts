/** P4 frozen numeric policy: identical in Node and the browser bundle. */
export const FUNCTION2D_ADAPTER_VERSION = "0.1.0";
export const FUNCTION_SAMPLE_COUNT = 257;
export const FUNCTION_EPS = 1e-9;

/** All 8 registry function2d capabilities implemented by this adapter. */
export const FUNCTION2D_CAPABILITIES: ReadonlySet<string> = new Set([
  "function2d.expression_curve",
  "function2d.roots",
  "function2d.intersection",
  "function2d.derivative_at",
  "function2d.extremum",
  "function2d.parameter_sweep",
  "function2d.value_at",
  "function2d.solve_equation"
]);

export const CAPABILITY_TO_CLAIM_KIND: Record<string, string> = {
  "function2d.roots": "roots",
  "function2d.intersection": "intersection",
  "function2d.derivative_at": "derivative_at",
  "function2d.extremum": "extremum",
  "function2d.value_at": "value_at",
  "function2d.solve_equation": "solve_equation"
};

export const CLAIM_CAPABILITIES: ReadonlySet<string> = new Set(Object.keys(CAPABILITY_TO_CLAIM_KIND));
