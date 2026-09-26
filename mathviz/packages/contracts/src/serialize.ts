import { createHash } from "node:crypto";

/**
 * Canonical serialization (P0 determinism contract).
 *
 * Rules:
 *  1. Object keys are sorted recursively by UTF-16 code-unit order.
 *  2. Compact output: no insignificant whitespace, single line.
 *  3. UTF-8, no BOM, LF-free (single line).
 *  4. JSON numbers appear only in presentation-level fields; exact math values
 *     are strings, so JS number formatting is deterministic for our domain.
 *
 * canonicalSerialize(JSON.parse(canonicalSerialize(x))) === canonicalSerialize(x)
 * must hold byte-for-byte for every contract document.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = canonicalize(src[key]);
    }
    return out;
  }
  return value;
}

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(canonicalSerialize(value), "utf8").digest("hex");
}

export function roundTripStable(value: unknown): boolean {
  const once = canonicalSerialize(value);
  const twice = canonicalSerialize(JSON.parse(once));
  return once === twice;
}
