// Runtime error factory — mirrors the frozen error catalog.
// Emitting a code outside the catalog is a harness bug and must throw loudly,
// exactly like the P0 contracts gate.

import { VizErrorCode } from "./types";

const CATALOG: ReadonlySet<string> = new Set<VizErrorCode>([
  "E_SCHEMA",
  "E_PROVENANCE",
  "E_CAPABILITY_UNSUPPORTED",
  "E_MATH_CONSTRAINT",
  "E_MATH_ASSERTION",
  "E_BINDING",
  "E_SCENE_COVERAGE",
  "E_LAYOUT",
  "E_NONDETERMINISTIC",
  "E_RENDER"
]);

export class VizRuntimeError extends Error {
  constructor(public readonly code: VizErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "VizRuntimeError";
  }
}

export function makeRuntimeError(code: VizErrorCode, message: string): VizRuntimeError {
  if (!CATALOG.has(code)) {
    throw new Error(`runtime bug: error code not in frozen catalog: '${code}'`);
  }
  return new VizRuntimeError(code, message);
}
