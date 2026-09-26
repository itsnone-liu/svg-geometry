import { eq, rat } from "./rational";
import { fromExact } from "./exact";
import { timeAsRat, positionOnBody } from "./events";
import type { AssertionOutcome } from "../../../runtime/src/domain";
import type { MotionSnapshot, VerifiedMotionProgram } from "./types";

export function assertMotion(program: VerifiedMotionProgram, snapshot: MotionSnapshot): AssertionOutcome[] {
  return program.assertions.map((a) => {
    const event = program.events.find((e) =>
      e.capabilityId === a.capabilityId &&
      e.participants.length === a.subjects.length &&
      e.participants.every((id) => a.subjects.includes(id))
    );
    let pass = !!event;
    let detail = event ? `compiled exact event ${event.time.p}/${event.time.q} s at ${event.position.p}/${event.position.q} m` : "no matching compiled event";
    if (event && snapshot.modelTime !== null && snapshot.modelTime === Number(event.time.p) / Number(event.time.q)) {
      const time = timeAsRat(snapshot.modelTime, program.bodies, program.events);
      const positions = event.participants.map((id) => positionOnBody(program.bodies.find((b) => b.id === id)!, time));
      pass = positions.every((p) => eq(p, positions[0] ?? rat(0n)));
      detail = `event equality at ${event.time.p}/${event.time.q} s: ${positions.map((p) => `${p.p}/${p.q}`).join(" = ")}`;
    }
    return { assertion_id: a.assertionId, capability: a.capabilityId, pass, expectation: a.expectation, subjects: a.subjects, detail };
  });
}
