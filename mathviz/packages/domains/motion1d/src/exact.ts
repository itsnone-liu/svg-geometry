import { rat, add as ratAdd, sub as ratSub, mul as ratMul, div as ratDiv, cmp as ratCmp, eq as ratEq, toNumber as ratToNumber, type Rat } from "./rational";
import { makeRuntimeError } from "../../../runtime/src/errors";
import type { ExactRational } from "./types";

export function fromJson(value: unknown, where: string): Rat {
  if (typeof value === "number" && Number.isSafeInteger(value)) return rat(BigInt(value));
  if (typeof value === "string") {
    if (/^-?(0|[1-9]\d*)$/.test(value)) return rat(BigInt(value));
    const m = /^(-?(?:0|[1-9]\d*))\/([1-9]\d*)$/.exec(value);
    if (m) return rat(BigInt(m[1]), BigInt(m[2]));
  }
  if (value && typeof value === "object") {
    const v: any = value;
    if (v.kind === "int" && typeof v.value === "string" && /^-?(0|[1-9]\d*)$/.test(v.value)) return rat(BigInt(v.value));
    if (v.kind === "rational" && typeof v.p === "string" && typeof v.q === "string" && /^-?(0|[1-9]\d*)$/.test(v.p) && /^[1-9]\d*$/.test(v.q)) {
      return rat(BigInt(v.p), BigInt(v.q));
    }
    if (v.kind === "symbolic" && v.expr?.t === "num") return fromJson(v.expr.v, where);
  }
  throw makeRuntimeError("E_SCHEMA", `${where}: expected exact integer/rational, got ${JSON.stringify(value)}`);
}

export function fromExact(value: ExactRational): Rat {
  return rat(BigInt(value.p), BigInt(value.q));
}

export function toExact(value: Rat): ExactRational {
  return { kind: "rational", p: value.p.toString(), q: value.q.toString() };
}

export function toNumber(value: Rat): number {
  const n = ratToNumber(value);
  if (!Number.isFinite(n)) throw makeRuntimeError("E_MATH_CONSTRAINT", "rational cannot be represented as finite number for RuntimeState");
  return n;
}

export function compare(a: Rat, b: Rat): number { return ratCmp(a, b); }
export function equal(a: Rat, b: Rat): boolean { return ratEq(a, b); }
export { rat, ratAdd, ratSub, ratMul, ratDiv, ratCmp, ratEq, ratToNumber };
