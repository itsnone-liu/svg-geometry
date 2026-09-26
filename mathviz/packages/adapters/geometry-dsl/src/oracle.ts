// G11 oracle: recompute MathViz geometry2d constructions through the PINNED
// upstream Geometry DSL kernel and compare within GEOMETRY_EPS.
//
// Independence guarantee: MathViz's geometry2d implements its own math
// (packages/domains/geometry2d/src/constructions/ops.ts); this oracle uses
// the upstream kernel ONLY. Neither side calls the other's helpers — the
// cross-check is a true two-implementation comparison.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { bridge } from "./bridge";
import { ADAPTER_VERSION, GEOMETRY_DSL_PIN, GEOMETRY_DSL_REPO } from "./version";

export interface OracleComparisonRow {
  op: "midpoint" | "rotate" | "intersection" | "projection";
  label: string;
  ours: { x: number; y: number };
  oracle: { x: number; y: number };
  delta: number;
  ok: boolean;
}

export function assertPinnedVendor(): { pinned: boolean; head: string } {
  // Offline/reproducible G11 source is vendored INSIDE this adapter boundary
  // from the exact upstream commit. The workspace clone is ignored and is
  // only used to verify/copy provenance during development.
  const file = path.resolve(__dirname, "..", "vendor", "geometry-dsl", "PINNED_COMMIT");
  if (!fs.existsSync(file)) return { pinned: false, head: "adapter vendored source/pin metadata missing" };
  const pinText = fs.readFileSync(file, "utf8");
  const m = /^commit=(\w+)/m.exec(pinText);
  const head = m?.[1] ?? "invalid PINNED_COMMIT metadata";
  const vendorRoot = path.resolve(__dirname, "..", "vendor", "geometry-dsl");
  const sumsFile = path.join(vendorRoot, "UPSTREAM_SHA256SUMS");
  if (!fs.existsSync(sumsFile)) return { pinned: false, head: "UPSTREAM_SHA256SUMS missing" };
  const rows = fs.readFileSync(sumsFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
  let checksumsOk = rows.length > 0;
  for (const row of rows) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(row);
    if (!match) { checksumsOk = false; break; }
    const filePath = path.join(vendorRoot, match[2]);
    if (!fs.existsSync(filePath)) { checksumsOk = false; break; }
    const text = fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
    const actual = createHash("sha256").update(text, "utf8").digest("hex");
    if (actual !== match[1]) { checksumsOk = false; break; }
  }
  return { pinned: head === GEOMETRY_DSL_PIN && checksumsOk, head };
}

export function comparePoint(op: OracleComparisonRow["op"], label: string, ours: { x: number; y: number }, oracle: { x: number; y: number }, eps: number): OracleComparisonRow {
  const delta = Math.hypot(ours.x - oracle.x, ours.y - oracle.y);
  return { op, label, ours, oracle, delta, ok: delta <= eps };
}

export const oracle = {
  version: ADAPTER_VERSION,
  repo: `${GEOMETRY_DSL_REPO}@${GEOMETRY_DSL_PIN}`,
  midpoint: bridge.midpoint,
  rotateAround: bridge.rotateAround,
  intersection: bridge.intersection,
  projection: bridge.projection
};
