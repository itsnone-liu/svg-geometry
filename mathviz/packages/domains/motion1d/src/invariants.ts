import { eq, cmp } from "./rational";
import { fromExact } from "./exact";
import { evaluateMotion } from "./evaluate";
import type { MotionSnapshot, VerifiedMotionProgram } from "./types";
import { positionOnBody, timeAsRat } from "./events";

export interface MotionInvariantResult {
  name: string;
  pass: boolean;
  detail: string;
}

/** G12 semantic invariants, checked at arbitrary and event-anchor model times. */
export function checkMotionInvariants(program: VerifiedMotionProgram, times: number[]): MotionInvariantResult[] {
  const results: MotionInvariantResult[] = [];
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
      results.push({ name: `event-equality:${event.eventId}`, pass: positions.length === 1 || positions.every((x) => x === positions[0]), detail: `event=${event.time.p}/${event.time.q}, positions=${positions.join(",")}` });
    }
  }
  return results;
}
