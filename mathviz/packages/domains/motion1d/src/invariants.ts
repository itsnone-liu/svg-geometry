import { eq, cmp, add, sub, div, rat, type Rat } from "./rational";
import { fromExact } from "./exact";
import { evaluateMotion } from "./evaluate";
import type { MotionSnapshot, VerifiedMotionProgram } from "./types";
import { positionOnBody, timeAsRat, eventSolveInterval } from "./events";

export interface MotionInvariantResult {
  name: string;
  pass: boolean;
  detail: string;
}

const ZERO = rat(0n);
function midpoint(a: Rat, b: Rat): Rat { return div(add(a, b), rat(2n)); }
function fmt(r: Rat): string { return `${r.p}/${r.q}`; }

/** G12 semantic invariants, checked at arbitrary and event-anchor model times. */
export function checkMotionInvariants(program: VerifiedMotionProgram, times: number[]): MotionInvariantResult[] {
  const results: MotionInvariantResult[] = [];
  const bodyById = new Map(program.bodies.map((b) => [b.id, b]));
  for (const t of times) {
    const exactT = timeAsRat(t, program.bodies, program.events);
    const snapshot = evaluateMotion(program, { modelTime: t, env: {}, resolveBinding: () => undefined }) as MotionSnapshot;
    for (const body of program.bodies) {
      const expected = positionOnBody(body, exactT);
      const actual = snapshot.entities[body.id].position!;
      const expectedNumber = Number(expected.p) / Number(expected.q);
      results.push({ name: `position:${body.id}@${t}`, pass: Number.isFinite(actual) && Math.abs(actual - expectedNumber) <= Math.max(1, Math.abs(expectedNumber)) * 1e-12, detail: `${actual} vs exact ${expected.p}/${expected.q}` });
      const segIndex = snapshot.entities[body.id].segmentIndex;
      if (segIndex !== null && segIndex !== undefined) {
        const seg = body.segments[segIndex];
        const start = fromExact(seg.start);
        const valid = cmp(exactT, start) >= 0 && (!seg.end || cmp(exactT, fromExact(seg.end)) < 0 || (segIndex === body.segments.length - 1 && eq(exactT, fromExact(seg.end))));
        results.push({ name: `segment-domain:${body.id}@${t}`, pass: valid, detail: `segment=${segIndex}, t=${exactT.p}/${exactT.q}` });
      }
    }
    for (const event of program.events) {
      if (t !== Number(event.time.p) / Number(event.time.q)) continue;
      const positions = event.participants.map((id) => snapshot.entities[id]?.position);
      results.push({ name: `event-equality-snapshot:${event.eventId}@${t}`, pass: positions.length === 1 || positions.every((x) => x === positions[0]), detail: `event=${event.time.p}/${event.time.q}, positions=${positions.join(",")}` });
    }
  }
  // P3.1 A4 — event equality is proven on the exact rational program, not on
  // Number-coerced snapshot values; the snapshot check above stays as a
  // diagnostic only.
  for (const event of program.events) {
    const exactT = fromExact(event.time);
    const bodies = event.participants.map((id) => bodyById.get(id)).filter((b) => !!b) as VerifiedMotionProgram["bodies"];
    if (bodies.length !== event.participants.length) {
      results.push({ name: `event-equality-exact:${event.eventId}`, pass: false, detail: "participant is not a body" });
      continue;
    }
    const positions = bodies.map((b) => positionOnBody(b, exactT));
    const pass = positions.every((p) => eq(p, positions[0]));
    results.push({ name: `event-equality-exact:${event.eventId}`, pass, detail: `exact positions ${positions.map(fmt).join(" = ")} at ${fmt(exactT)}` });
  }
  // P3.1 A3 — overtake reversal semantics written as exact evidence: the first
  // participant (pursuer) must be strictly behind before the event, equal at
  // it, and strictly ahead after it. Test points are exact rationals built
  // inside the same legal eventSegment interval that solved the event.
  for (const event of program.events) {
    if (event.capabilityId !== "motion1d.overtake_event" || event.participants.length !== 2) continue;
    const pursuer = bodyById.get(event.participants[0]);
    const target = bodyById.get(event.participants[1]);
    if (!pursuer || !target) {
      results.push({ name: `overtake-reversal:${event.eventId}`, pass: false, detail: "missing participant body" });
      continue;
    }
    const exactT = fromExact(event.time);
    const interval = eventSolveInterval(pursuer, target, "overtake", exactT);
    if (!interval) {
      results.push({ name: `overtake-reversal:${event.eventId}`, pass: false, detail: "event time not reproducible on eventSegment pairs" });
      continue;
    }
    const before = midpoint(interval.start, exactT);
    const after = interval.end ? midpoint(exactT, interval.end) : add(exactT, rat(1n));
    const relBefore = sub(positionOnBody(pursuer, before), positionOnBody(target, before));
    const relAt = sub(positionOnBody(pursuer, exactT), positionOnBody(target, exactT));
    const relAfter = sub(positionOnBody(pursuer, after), positionOnBody(target, after));
    const pass = cmp(relBefore, ZERO) < 0 && eq(relAt, ZERO) && cmp(relAfter, ZERO) > 0;
    results.push({
      name: `overtake-reversal:${event.eventId}`,
      pass,
      detail: `relative ${fmt(relBefore)} < 0 = ${fmt(relAt)} < ${fmt(relAfter)} at before=${fmt(before)}/after=${fmt(after)} in [${fmt(interval.start)}, ${interval.end ? fmt(interval.end) : "inf"})`
    });
  }
  return results;
}
