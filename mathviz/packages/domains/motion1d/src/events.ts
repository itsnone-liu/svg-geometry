import { add, sub, mul, div, cmp, eq, type Rat, rat } from "./rational";
import type { MotionBodyProgram, SolvedMotionEvent, MotionEventKind } from "./types";
import { fromExact, toExact, toNumber } from "./exact";
import { makeRuntimeError } from "../../../runtime/src/errors";

function endOf(s: MotionBodyProgram["segments"][number]): Rat | null { return s.end ? fromExact(s.end) : null; }
function startOf(s: MotionBodyProgram["segments"][number]): Rat { return fromExact(s.start); }
function posAt(s: MotionBodyProgram["segments"][number], t: Rat): Rat {
  return add(fromExact(s.startPosition), mul(fromExact(s.velocity), sub(t, startOf(s))));
}
function max(a: Rat, b: Rat): Rat { return cmp(a, b) >= 0 ? a : b; }

/**
 * P3.1 A1 — the body's effective event time-domain is
 *
 *   [first_motion_start, +inf)
 *
 * Original motion segments cover the moving part; when the final segment has a
 * finite end, a synthetic stationary tail [final.end, null) with velocity 0 at
 * the final position extends the domain. A delayed body therefore does not
 * participate before its first segment starts, and a body that has stopped
 * still exists at its endpoint and can be caught later.
 *
 * This view is used ONLY by the event solver and G12 invariants. It is never
 * written back into VerifiedMotionProgram.segments.
 */
export interface EventSegment {
  start: Rat;
  end: Rat | null;
  startPosition: Rat;
  velocity: Rat;
  synthetic: boolean;
}

export function eventSegments(body: MotionBodyProgram): EventSegment[] {
  const view: EventSegment[] = body.segments.map((s) => ({
    start: startOf(s),
    end: endOf(s),
    startPosition: fromExact(s.startPosition),
    velocity: fromExact(s.velocity),
    synthetic: false
  }));
  const last = body.segments[body.segments.length - 1];
  if (last && last.end) {
    const tailStart = endOf(last)!;
    view.push({
      start: tailStart,
      end: null,
      startPosition: posAt(last, tailStart),
      velocity: rat(0n),
      synthetic: true
    });
  }
  return view;
}

function withinES(s: EventSegment, t: Rat, isLast: boolean): boolean {
  if (cmp(t, s.start) < 0) return false;
  if (!s.end) return true;
  return cmp(t, s.end) < 0 || (isLast && eq(t, s.end));
}
function posAtES(s: EventSegment, t: Rat): Rat {
  return add(s.startPosition, mul(s.velocity, sub(t, s.start)));
}
function interceptES(s: EventSegment): Rat {
  return sub(s.startPosition, mul(s.velocity, s.start));
}
function minEnd(a: Rat | null, b: Rat | null): Rat | null {
  if (!a) return b;
  if (!b) return a;
  return cmp(a, b) <= 0 ? a : b;
}

export function positionOnBody(body: MotionBodyProgram, t: Rat): Rat {
  if (body.segments.length === 0) return fromExact(body.initialPosition);
  for (let i = 0; i < body.segments.length; i++) {
    const s = body.segments[i];
    if (withinES({ start: startOf(s), end: endOf(s), startPosition: fromExact(s.startPosition), velocity: fromExact(s.velocity), synthetic: false }, t, i === body.segments.length - 1)) return posAt(s, t);
  }
  const first = body.segments[0];
  if (cmp(t, startOf(first)) < 0) return fromExact(body.initialPosition);
  const last = body.segments[body.segments.length - 1];
  const end = endOf(last);
  if (end && cmp(t, end) >= 0) return posAt(last, end);
  throw makeRuntimeError("E_MATH_CONSTRAINT", `body '${body.id}' has an uncovered time ${toExact(t).p}/${toExact(t).q}`);
}

function solveOnPair(
  a: EventSegment,
  b: EventSegment,
  isLastA: boolean,
  isLastB: boolean,
  mode: "meeting" | "overtake"
): Rat | null {
  const lo = max(a.start, b.start);
  const hi = minEnd(a.end, b.end);
  if (hi && cmp(lo, hi) > 0) return null;
  const relativeVelocity = sub(a.velocity, b.velocity);
  const relativeIntercept = sub(interceptES(a), interceptES(b));

  if (eq(relativeVelocity, { p: 0n, q: 1n })) {
    if (!eq(relativeIntercept, { p: 0n, q: 1n })) return null;
    if (mode === "overtake") return null; // equality without order reversal is not catching up
    if (!withinES(a, lo, isLastA) || !withinES(b, lo, isLastB)) return null;
    return lo;
  }
  const t = div({ p: -relativeIntercept.p, q: relativeIntercept.q }, relativeVelocity);
  if (cmp(t, lo) < 0 || (hi && cmp(t, hi) > 0)) return null;
  if (!withinES(a, t, isLastA) || !withinES(b, t, isLastB)) return null;
  if (mode === "overtake") {
    // Relative position must cross from negative to positive inside a shared
    // active interval. A same-time initial equality is not a catch event.
    if (cmp(relativeVelocity, { p: 0n, q: 1n }) <= 0) return null;
    if (cmp(t, lo) <= 0) return null;
    if (hi && cmp(t, hi) >= 0) return null; // no post-event interval to prove reversal
  }
  return t;
}

export function solvePairEvent(
  eventId: string,
  capabilityId: MotionEventKind,
  a: MotionBodyProgram,
  b: MotionBodyProgram
): SolvedMotionEvent {
  const mode = capabilityId === "motion1d.overtake_event" ? "overtake" : "meeting";
  // P3.1 A2 — enumerate the effective event domains, not the raw motion
  // segments: eventSegments(A) x eventSegments(B).
  const as = eventSegments(a);
  const bs = eventSegments(b);
  const candidates: Rat[] = [];
  for (let i = 0; i < as.length; i++) {
    for (let j = 0; j < bs.length; j++) {
      const t = solveOnPair(as[i], bs[j], i === as.length - 1, j === bs.length - 1, mode);
      if (t) candidates.push(t);
    }
  }
  if (!candidates.length) {
    throw makeRuntimeError("E_MATH_CONSTRAINT", `event '${eventId}' (${capabilityId}) has no legal ${mode} solution for active motion intervals`);
  }
  candidates.sort(cmp);
  const time = candidates[0];
  const position = positionOnBody(a, time);
  if (!eq(position, positionOnBody(b, time))) {
    throw makeRuntimeError("E_MATH_CONSTRAINT", `event '${eventId}' solver produced unequal positions`);
  }
  return { eventId, capabilityId, participants: [a.id, b.id], time: toExact(time), position: toExact(position) };
}

/**
 * P3.1 A3 — recover the exact legal interval [lo, hi] of the eventSegment pair
 * that produced `time`, so invariants can build exact rational test points
 * inside the same interval the solver used. hi === null means +inf.
 */
export function eventSolveInterval(
  a: MotionBodyProgram,
  b: MotionBodyProgram,
  mode: "meeting" | "overtake",
  time: Rat
): { start: Rat; end: Rat | null } | null {
  const as = eventSegments(a);
  const bs = eventSegments(b);
  for (let i = 0; i < as.length; i++) {
    for (let j = 0; j < bs.length; j++) {
      const sa = as[i], sb = bs[j];
      const t = solveOnPair(sa, sb, i === as.length - 1, j === bs.length - 1, mode);
      if (t && eq(t, time)) {
        return { start: max(sa.start, sb.start), end: minEnd(sa.end, sb.end) };
      }
    }
  }
  return null;
}

export function solveReachEvent(
  eventId: string,
  capabilityId: "motion1d.reach_event",
  body: MotionBodyProgram,
  target: Rat
): SolvedMotionEvent {
  const candidates: Rat[] = [];
  for (let i = 0; i < body.segments.length; i++) {
    const s = body.segments[i];
    const v = fromExact(s.velocity);
    const start = startOf(s);
    const x0 = fromExact(s.startPosition);
    if (eq(v, { p: 0n, q: 1n })) {
      if (eq(x0, target)) candidates.push(start);
      continue;
    }
    const t = add(start, div(sub(target, x0), v));
    const end = endOf(s);
    const inside = cmp(t, start) >= 0 && (!end || cmp(t, end) < 0 || (i === body.segments.length - 1 && eq(t, end)));
    if (inside) candidates.push(t);
  }
  if (!candidates.length) throw makeRuntimeError("E_MATH_CONSTRAINT", `event '${eventId}' (${capabilityId}) has no legal reach solution`);
  candidates.sort(cmp);
  const time = candidates[0];
  return { eventId, capabilityId, participants: [body.id], time: toExact(time), position: toExact(target) };
}

export function timeAsRat(time: number, bodies: MotionBodyProgram[], events: SolvedMotionEvent[]): Rat {
  if (!Number.isFinite(time)) throw makeRuntimeError("E_MATH_CONSTRAINT", "modelTime must be finite");
  for (const event of events) {
    const exact = fromExact(event.time);
    if (toNumber(exact) === time) return exact;
  }
  for (const body of bodies) {
    for (const segment of body.segments) {
      for (const edge of [segment.start, segment.end].filter(Boolean) as NonNullable<typeof segment.start>[]) {
        const exact = fromExact(edge);
        if (toNumber(exact) === time) return exact;
      }
    }
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(time));
  if (!m) throw makeRuntimeError("E_MATH_CONSTRAINT", `cannot convert modelTime '${time}' to rational`);
  const fraction = m[3] ?? "";
  const exponent = Number(m[4] ?? "0");
  let p = BigInt(m[2] + fraction) * (m[1] === "-" ? -1n : 1n);
  let q = 10n ** BigInt(fraction.length);
  if (exponent > 0) p *= 10n ** BigInt(exponent);
  else if (exponent < 0) q *= 10n ** BigInt(-exponent);
  return rat(p, q);
}
