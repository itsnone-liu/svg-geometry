// Timeline evaluation at a single presentation time. Pure: no clock, no state
// carried between calls — every query re-derives from the compiled actions.
//
// Frozen semantics:
//   visibility: default visible = true; persistent show/hide (no until) apply
//     in timestamp order, last wins; windowed show/hide ([at, until)) apply
//     ON TOP of the persistent state while active.
//   highlight/dim: independent booleans, same dual rule (persistent without
//     until, windowed with until: at <= t < until).
//   camera: default {zoom 1, center null}; last camera with at <= t wins
//     (duplicates at the same timestamp are rejected at compile time).
//   caption: active iff at <= t < (until ?? duration).

import { CompiledTimeline } from "./compile";
import { modelTimeAt } from "./model-time";
import { CameraState, CaptionState } from "../types";

export interface TargetFlags {
  visible: boolean;
  highlighted: boolean;
  dimmed: boolean;
}

export interface TimelineEval {
  modelTime: number | null;
  camera: CameraState;
  caption: CaptionState | null;
  flags: Record<string, TargetFlags>;
}

export function evalTimeline(ct: CompiledTimeline, t: number): TimelineEval {
  const modelTime = modelTimeAt(ct.windows, t);

  const targets = new Set<string>();
  for (const v of ct.visibility) targets.add(v.target);
  for (const h of ct.highlights) targets.add(h.target);

  const flags: Record<string, TargetFlags> = {};
  for (const target of targets) {
    const base = { visible: true, highlighted: false, dimmed: false };
    // persistent pass (no until), timestamp order
    for (const v of ct.visibility) {
      if (v.target !== target || v.until !== undefined || !(v.at <= t)) continue;
      base.visible = v.kind === "show";
    }
    for (const h of ct.highlights) {
      if (h.target !== target || h.until !== undefined || !(h.at <= t)) continue;
      if (h.kind === "highlight") base.highlighted = true;
      else base.dimmed = true;
    }
    // windowed pass (with until): active while at <= t < until
    for (const v of ct.visibility) {
      if (v.target !== target || v.until === undefined) continue;
      if (v.at <= t && t < v.until) base.visible = v.kind === "show";
    }
    for (const h of ct.highlights) {
      if (h.target !== target || h.until === undefined) continue;
      if (h.at <= t && t < h.until) {
        if (h.kind === "highlight") base.highlighted = true;
        else base.dimmed = true;
      }
    }
    flags[target] = base;
  }

  let camera: CameraState = { zoom: 1, center_on: null };
  for (const c of ct.cameras) {
    if (c.at <= t) {
      camera = { zoom: c.zoom ?? 1, center_on: c.center_on ?? null };
    }
  }

  let caption: CaptionState | null = null;
  for (const c of ct.captions) {
    const end = c.until ?? ct.duration;
    if (c.at <= t && t < end) {
      caption = { text: c.text, started_at: c.at };
    }
  }

  return { modelTime, camera, caption, flags };
}
