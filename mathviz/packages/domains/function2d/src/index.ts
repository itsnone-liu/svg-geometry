export { function2dAdapter } from "./adapter";
export { compileFunction } from "./compile";
export { evaluateFunction } from "./evaluate";
export { assertFunctions } from "./assertions";
export { differentiate, assertDifferentiable } from "./differentiate";
export { sampleFunction } from "./sampling";
export { checkCartesianWindow, parseWindowRule } from "./layout";
export type { CartesianWindow } from "./layout";
export {
  FUNCTION2D_ADAPTER_VERSION,
  FUNCTION2D_CAPABILITIES,
  FUNCTION_SAMPLE_COUNT,
  FUNCTION_EPS
} from "./constants";
export type {
  VerifiedFunctionProgram,
  CompiledFunction,
  CompiledEquation,
  FunctionClaim,
  FunctionAssertion,
  FunctionSamplingPolicy,
  FunctionSnapshot,
  FunctionSnapshotEntity
} from "./types";
