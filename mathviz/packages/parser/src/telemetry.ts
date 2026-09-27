// Deterministic validated-spec cache + usage telemetry (P5.1 §31-32).
//
// cache key = sha256(parser_contract_version + prompt_policy_version +
// provider.id + statement). Only VALIDATED specs are cached; failures never
// become production cache entries.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PARSER_CONTRACT_VERSION, PROMPT_POLICY_VERSION } from "./prompt";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CACHE_DIR = path.join(ROOT, "runs", "parser-cache");

export function cacheKey(providerId: string, statement: string): string {
  return createHash("sha256")
    .update(PARSER_CONTRACT_VERSION)
    .update("\u0000")
    .update(PROMPT_POLICY_VERSION)
    .update("\u0000")
    .update(providerId)
    .update("\u0000")
    .update(statement)
    .digest("hex");
}

export function cacheGet(providerId: string, statement: string): any | null {
  const p = path.join(CACHE_DIR, `${cacheKey(providerId, statement)}.json`);
  try {
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    return doc.status === "VALIDATED" ? doc.spec : null;
  } catch {
    return null;
  }
}

export function cachePut(providerId: string, statement: string, spec: any): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const p = path.join(CACHE_DIR, `${cacheKey(providerId, statement)}.json`);
  fs.writeFileSync(p, JSON.stringify({ status: "VALIDATED", contract: PARSER_CONTRACT_VERSION, policy: PROMPT_POLICY_VERSION, provider: providerId, spec }, null, 2) + "\n", "utf8");
}

/** Count of changed top-level paths between two specs (repair_delta). */
export function repairDelta(a: any, b: any): number {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  let changed = 0;
  for (const k of keys) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) changed++;
  }
  return changed;
}

/** Answer-leakage scan (G17): a ProblemSpec must contain nothing that looks
 * like an answer channel. Structural guarantees (additionalProperties:false)
 * make this belt-and-braces: it catches regressions in the schema itself. */
export function leakScan(spec: any): string[] {
  const hits: string[] = [];
  const walk = (node: any, trail: string) => {
    if (Array.isArray(node)) {
      node.forEach((x, i) => walk(x, `${trail}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const t = trail ? `${trail}.${k}` : k;
        if (/^(answer|result|solution|expected|derived_facts|events|assertions|runtime_values)$/i.test(k)) {
          hits.push(t);
        }
        walk(v, t);
      }
    }
  };
  walk(spec, "");
  return hits;
}
