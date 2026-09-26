// Pinned upstream identity (P2).
//
// The Geometry DSL is a COMPILE-TIME geometry oracle / kernel reference.
// It never enters the browser bundle, the per-frame runtime, Math IR,
// Scene IR, or renderer-svg. If upstream disappears, only this adapter
// package is replaced — MathViz core contracts stay untouched.

export const GEOMETRY_DSL_REPO = "shand001/geometry-dsl";
export const GEOMETRY_DSL_VERSION = "0.4.0";
export const GEOMETRY_DSL_PIN = "c7ee10030c175acad792ba82b53af540f2b578f8";
export const GEOMETRY_DSL_LICENSE = "MIT (attribution preserved in vendor/geometry-dsl/LICENSE)";

/** What the manifest declares (P2 fixtures already carry this). */
export const MANIFEST_ADAPTER_VERSION = `pin:${GEOMETRY_DSL_PIN}`;

export const ADAPTER_VERSION = `0.1.0+geometry-dsl@${GEOMETRY_DSL_PIN.slice(0, 7)}`;
