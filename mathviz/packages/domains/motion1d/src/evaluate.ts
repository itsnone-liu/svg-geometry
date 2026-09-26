import { digestOf } from "../../../runtime/src/digest";
import type { DomainEvaluationContext } from "../../../runtime/src/domain";
import { fromExact, toNumber } from "./exact";
import { positionOnBody, timeAsRat } from "./events";
import type { MotionSnapshot, VerifiedMotionProgram } from "./types";

export function evaluateMotion(program: VerifiedMotionProgram, ctx: DomainEvaluationContext): MotionSnapshot {
  const entities: MotionSnapshot["entities"] = {};
  const t = ctx.modelTime;
  for (const body of program.bodies) {
    let position = fromExact(body.initialPosition);
    let velocity = { p: 0n, q: 1n };
    let active = false;
    let segmentIndex: number | null = null;
    if (t !== null) {
      // Number modelTime originates in the shared Timeline contract. Convert
      // once to the nearest exact decimal rational, with boundaries snapped to
      // exact segment rationals when Number representations are equal.
      const time = timeAsRat(t, program.bodies, program.events);
      for (let i = 0; i < body.segments.length; i++) {
        const segment = body.segments[i];
        const start = fromExact(segment.start);
        const end = segment.end ? fromExact(segment.end) : null;
        const inside = compare(time, start) >= 0 && (!end || compare(time, end) < 0);
        if (inside) {
          position = positionOnBody(body, time);
          velocity = fromExact(segment.velocity);
          active = true;
          segmentIndex = i;
          break;
        }
      }
      if (!active && body.segments.length) {
        const first = body.segments[0];
        if (compare(time, fromExact(first.start)) < 0) position = fromExact(body.initialPosition);
        else {
          const last = body.segments[body.segments.length - 1];
          if (last.end && compare(time, fromExact(last.end)) >= 0) {
            position = positionOnBody(body, fromExact(last.end));
          } else if (!last.end) {
            // An unbounded last segment should have matched above.
            position = positionOnBody(body, time);
            velocity = fromExact(last.velocity);
            active = true;
            segmentIndex = body.segments.length - 1;
          }
        }
      }
    }
    entities[body.id] = { kind: "body", position: toNumber(position), velocity: active ? toNumber(velocity) : 0, active, segmentIndex };
  }
  for (const marker of program.markers) {
    const event = program.events.find((candidate) => candidate.eventId === marker.eventId)!;
    entities[marker.id] = {
      kind: "event",
      eventId: event.eventId,
      capabilityId: event.capabilityId,
      time: toNumber(fromExact(event.time)),
      position: toNumber(fromExact(event.position)),
      velocity: 0,
      active: false,
      segmentIndex: null
    };
  }
  const partial = { modelTime: t, entities };
  return { ...partial, digest: digestOf(partial) };
}

function compare(a: {p: bigint;q:bigint}, b: {p:bigint;q:bigint}): number {
  const d = a.p * b.q - b.p * a.q;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}
