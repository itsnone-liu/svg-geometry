import { rat, mul, type Rat } from "./rational";
import { makeRuntimeError } from "../../../runtime/src/errors";

export type Dimension = "distance" | "time" | "velocity";
export interface UnitDef { dimension: Dimension; factorToCanonical: Rat; canonical: string }

const U: Record<string, UnitDef> = {
  m: { dimension: "distance", factorToCanonical: rat(1n), canonical: "m" },
  km: { dimension: "distance", factorToCanonical: rat(1000n), canonical: "m" },
  s: { dimension: "time", factorToCanonical: rat(1n), canonical: "s" },
  min: { dimension: "time", factorToCanonical: rat(60n), canonical: "s" },
  h: { dimension: "time", factorToCanonical: rat(3600n), canonical: "s" },
  "m/s": { dimension: "velocity", factorToCanonical: rat(1n), canonical: "m/s" },
  "km/h": { dimension: "velocity", factorToCanonical: rat(5n, 18n), canonical: "m/s" }
};

export function unitDefinition(unit: unknown, expected: Dimension, where: string): UnitDef {
  const def = unitInfo(unit, where);
  if (def.dimension !== expected) {
    throw makeRuntimeError("E_MATH_CONSTRAINT", `${where}: unit '${unit}' has dimension ${def.dimension}, expected ${expected}`);
  }
  return def;
}

export function normalize(value: Rat, unit: unknown, expected: Dimension, where: string): Rat {
  return mul(value, unitDefinition(unit, expected, where).factorToCanonical);
}

export function canonicalUnit(dimension: Dimension): string {
  return dimension === "distance" ? "m" : dimension === "time" ? "s" : "m/s";
}

export function unitInfo(unit: unknown, where: string): UnitDef {
  if (typeof unit !== "string" || !U[unit]) {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `${where}: unsupported motion1d unit '${String(unit)}'`);
  }
  return U[unit];
}

export function supportedUnit(unit: string): boolean { return Object.prototype.hasOwnProperty.call(U, unit); }
