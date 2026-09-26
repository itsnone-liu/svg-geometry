// Timeline compilation: structural + semantic validation, happens ONCE at load.
// Frozen P1 semantics:
//   E4  every at/until/from/to must lie in [0, duration]; until > at        -> E_SCHEMA
//   E2  overlapping map_model_time windows                                  -> E_NONDETERMINISTIC
//   F   show+hide on the same target at the same timestamp                  -> E_NONDETERMINISTIC
//       two camera actions at the same timestamp                            -> E_NONDETERMINISTIC
//       two captions active at the same presentation time                   -> E_NONDETERMINISTIC
// No "last declaration wins" anywhere.

import { makeRuntimeError } from "../errors";
import { evalExpr, valueToNumber } from "../expr/evaluate";
import { ModelWindow } from "./model-time";

export interface VisAction { kind: "show" | "hide" | "highlight" | "dim"; target: string; at: number; until?: number }
export interface CamAction { at: number; zoom?: number; center_on?: string }
export interface CapAction { at: number; until?: number; text: string }

export interface CompiledTimeline {
  duration: number;
  fps: number;
  windows: ModelWindow[];
  visibility: VisAction[]; // show/hide
  highlights: VisAction[]; // highlight/dim
  cameras: CamAction[];
  captions: CapAction[];
}

export function compileTimeline(tl: any): CompiledTimeline {
  if (!tl || typeof tl !== "object") throw makeRuntimeError("E_SCHEMA", "timeline document missing");
  const duration = tl.duration;
  if (!(typeof duration === "number" && duration > 0)) throw makeRuntimeError("E_SCHEMA", "timeline.duration must be > 0");
  const fps = tl.fps ?? 30;

  const rangeCheck = (v: unknown, name: string, where: string): number => {
    if (typeof v !== "number" || !(v >= 0 && v <= duration)) {
      throw makeRuntimeError("E_SCHEMA", `${where}: ${name} must satisfy 0 <= ${name} <= duration (got ${v}, duration ${duration})`);
    }
    return v;
  };

  const windows: ModelWindow[] = [];
  const visibility: VisAction[] = [];
  const highlights: VisAction[] = [];
  const cameras: CamAction[] = [];
  const captions: CapAction[] = [];

  for (const track of tl.tracks ?? []) {
    for (const a of track?.actions ?? []) {
      const where = `track '${track?.track_id}'`;
      if (a?.kind === "map_model_time") {
        const from = rangeCheck(a.from, "from", where);
        const to = rangeCheck(a.to, "to", where);
        if (!(to > from)) throw makeRuntimeError("E_SCHEMA", `${where}: map_model_time requires to > from`);
        let modelFrom: number, modelTo: number;
        try {
          modelFrom = valueToNumber(evalExpr(a.model_from, {}));
          modelTo = valueToNumber(evalExpr(a.model_to, {}));
        } catch (err: any) {
          if (err?.code === "E_BINDING") throw makeRuntimeError("E_SCHEMA", `${where}: mapping endpoint references unknown symbol`);
          throw err;
        }
        windows.push({ from, to, modelFrom, modelTo });
      } else if (a?.kind === "show" || a?.kind === "hide") {
        visibility.push({ kind: a.kind, target: a.target, at: a.at, until: a.until });
      } else if (a?.kind === "highlight" || a?.kind === "dim") {
        highlights.push({ kind: a.kind, target: a.target, at: a.at, until: a.until });
      } else if (a?.kind === "camera") {
        cameras.push({ at: a.at, zoom: a.zoom, center_on: a.center_on });
      } else if (a?.kind === "caption") {
        captions.push({ at: a.at, until: a.until, text: a.text });
      } else {
        throw makeRuntimeError("E_SCHEMA", `${where}: unknown action kind '${a?.kind}'`);
      }
      if (a && a.until !== undefined) {
        rangeCheck(a.until, "until", where);
        if (!(a.until > a.at)) throw makeRuntimeError("E_SCHEMA", `${where}: until must be > at`);
      }
    }
  }

  // E4 range checks for the non-mapping actions' at values
  const allAt: Array<[unknown, string]> = [
    ...visibility.map(v => [v.at, `visibility on '${v.target}'`] as [unknown, string]),
    ...highlights.map(h => [h.at, `${h.kind} on '${h.target}'`] as [unknown, string]),
    ...cameras.map(c => [c.at, "camera"] as [unknown, string]),
    ...captions.map(c => [c.at, "caption"] as [unknown, string])
  ];
  for (const [at, where] of allAt) rangeCheck(at, "at", where);

  // E2 overlapping model-time windows
  windows.sort((x, y) => x.from - y.from);
  for (let i = 1; i < windows.length; i++) {
    if (windows[i].from < windows[i - 1].to) {
      throw makeRuntimeError(
        "E_NONDETERMINISTIC",
        `overlapping map_model_time windows: [${windows[i - 1].from},${windows[i - 1].to}) and [${windows[i].from},${windows[i].to})`
      );
    }
  }

  // F visibility conflicts: same target, same timestamp, show+hide
  const visSeen = new Map<string, Set<string>>();
  for (const v of visibility) {
    const key = `${v.target}@${v.at}`;
    const kinds = visSeen.get(key) ?? new Set<string>();
    kinds.add(v.kind);
    visSeen.set(key, kinds);
  }
  for (const [key, kinds] of visSeen) {
    if (kinds.has("show") && kinds.has("hide")) {
      throw makeRuntimeError("E_NONDETERMINISTIC", `conflicting show/hide on the same target at the same timestamp: ${key}`);
    }
  }

  // F camera conflicts: same timestamp
  const camAt = new Set<string>();
  for (const c of cameras) {
    const key = String(c.at);
    if (camAt.has(key)) throw makeRuntimeError("E_NONDETERMINISTIC", `two camera actions at the same timestamp: ${c.at}`);
    camAt.add(key);
  }

  // F caption overlap: active intervals [at, until ?? duration) must not intersect
  const capIntervals = captions
    .map(c => ({ at: c.at, end: c.until ?? duration, text: c.text }))
    .sort((x, y) => x.at - y.at);
  for (let i = 1; i < capIntervals.length; i++) {
    if (capIntervals[i].at < capIntervals[i - 1].end) {
      throw makeRuntimeError(
        "E_NONDETERMINISTIC",
        `overlapping captions: '${capIntervals[i - 1].text}' [${capIntervals[i - 1].at},${capIntervals[i - 1].end}) and '${capIntervals[i].text}' [${capIntervals[i].at},${capIntervals[i].end})`
      );
    }
  }

  return { duration, fps, windows, visibility, highlights, cameras, captions };
}
