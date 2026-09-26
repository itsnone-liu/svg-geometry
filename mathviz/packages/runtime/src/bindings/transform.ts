// Pure presentation transforms applied after resolving a Math binding.
// `scale` is a linear world-value -> normalized/presentation-value map; it does
// not alter Math IR, Runtime model time, or domain state.

import { makeRuntimeError } from "../errors";

export function applyBindingTransform(binding: any, value: unknown): unknown {
  const transform = binding?.transform;
  if (transform === undefined || transform === null) return value;
  if (transform.kind !== "scale") {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `binding transform '${String(transform.kind)}' is not implemented`);
  }
  const p = transform.params ?? {};
  const keys = ["domain_min", "domain_max", "range_min", "range_max"] as const;
  for (const key of keys) {
    if (typeof p[key] !== "number" || !Number.isFinite(p[key])) {
      throw makeRuntimeError("E_SCHEMA", `scale transform requires finite numeric '${key}'`);
    }
  }
  if (!(p.domain_max > p.domain_min)) {
    throw makeRuntimeError("E_MATH_CONSTRAINT", "scale transform domain_max must be greater than domain_min");
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw makeRuntimeError("E_BINDING", `scale transform source must resolve to a finite number (got ${String(value)})`);
  }
  const ratio = (value - p.domain_min) / (p.domain_max - p.domain_min);
  return p.range_min + ratio * (p.range_max - p.range_min);
}
