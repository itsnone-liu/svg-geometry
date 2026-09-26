import { add, sub, mul, div, cmp, eq, type Rat, rat } from "./rational";
import type { MotionBodyProgram, SolvedMotionEvent, MotionEventKind } from "./types";
import { fromExact, toExact, toNumber } from "./exact";
import { makeRuntimeError } from "../../../runtime/src/errors";

function endOf(s: MotionBodyProgram["segments"][number]): Rat | null { return s.end ? fromExact(s.end) : null; }
function startOf(s: MotionBodyProgram["segments"][number]): Rat { return fromExact(s.start); }
function posAt(s: MotionBodyProgram["segments"][number], t: Rat): Rat {
  return add(fromExact(s.startPosition), mul(fromExact(s.velocity), sub(t, startOf(s))));
}
function intercept(s: MotionBodyProgram["segments"][number]): Rat {
  return sub(fromExact(s.startPosition), mul(fromExact(s.velocity), startOf(s)));
}
function max(a: Rat, b: Rat): Rat { return cmp(a, b) >= 0 ? a : b; }
function minEnd(a: Rat | null, b: Rat | null): Rat | null {
  if (!a) return b;
  if (!b) return a;
  return cmp(a, b) <= 0 ? a : b;
}
function within(s: MotionBodyProgram["segments"][number], t: Rat, isLast: boolean): boolean {
  if (cmp(t, startOf(s)) < 0) return false;
  const end = endOf(s);
  if (!end) return true;
  return cmp(t, end) < 0 || (isLast && eq(t, end));
}

export function positionOnBody(body: MotionBodyProgram, t: Rat): Rat {
  if (body.segments.length === 0) return fromExact(body.initialPosition);
  for (let i = 0; i < body.segments.length; i++) {
    const s = body.segments[i];
    if (within(s, t, i === body.segments.length - 1)) return posAt(s, t);
  }
  const first = body.segments[0];
  if (cmp(t, startOf(first)) < 0) return fromExact(body.initialPosition);
  const last = body.segments[body.segments.length - 1];
  const end = endOf(last);
  if (end && cmp(t, end) >= 0) return posAt(last, end);
  throw makeRuntimeError("E_MATH_CONSTRAINT", `body '${body.id}' has an uncovered time ${toExact(t).p}/${toExact(t).q}`);
}

function solveOnPair(
  a: MotionBodyProgram["segments"][number],
  b: MotionBodyProgram["segments"][number],
  isLastA: boolean,
  isLastB: boolean,
  mode: "meeting" | "overtake"
): Rat | null {
  const lo = max(startOf(a), startOf(b));
  const hi = minEnd(endOf(a), endOf(b));
  if (hi && cmp(lo, hi) > 0) return null;
  const va = fromExact(a.velocity), vb = fromExact(b.velocity);
  const relativeVelocity = sub(va, vb);
  const relativeIntercept = sub(intercept(a), intercept(b));

  if (eq(relativeVelocity, { p: 0n, q: 1n })) {
    if (!eq(relativeIntercept, { p: 0n, q: 1n })) return null;
    if (mode === "overtake") return null; // equality without order reversal is not catching up
    if (!within(a, lo, isLastA) || !within(b, lo, isLastB)) return null;
    return lo;
  }
  const t = div({ p: -relativeIntercept.p, q: relativeIntercept.q }, relativeVelocity);
  if (cmp(t, lo) < 0 || (hi && cmp(t, hi) > 0)) return null;
  if (!within(a, t, isLastA) || !within(b, t, isLastB)) return null;
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
  const candidates: Rat[] = [];
  for (let i = 0; i < a.segments.length; i++) {
    for (let j = 0; j < b.segments.length; j++) {
      const t = solveOnPair(a.segments[i], b.segments[j], i === a.segments.length - 1, j === b.segments.length - 1, mode);
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
    if (within(s, t, i === body.segments.length - 1)) candidates.push(t);
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
