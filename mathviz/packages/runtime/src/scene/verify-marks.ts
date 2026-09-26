// Verified-mark gate (P2 frozen semantics).
//
// A mark primitive is a MATHEMATICAL CLAIM, not decoration:
//   1. the mark object must bind math:fact:F (the claimed fact);
//   2. attach_to must reference scene objects whose bindings resolve to
//      entities; the set of entity ids is the mark's subject set;
//   3. a compiled assertion with capability REQUIRED_CAP[primitive] must
//      cover exactly that subject set and have evaluated PASS at the
//      current time.
// Anything else -> E_MATH_ASSERTION (never silently drawn).
//
// Primitive -> required predicate capability (frozen):
//   right_angle_mark -> geometry2d.perpendicular
//   equal_tick       -> geometry2d.equal_length
//   parallel_mark    -> geometry2d.parallel
//   angle_mark       -> geometry2d.angle_mark (with params.value)

import { makeRuntimeError } from "../errors";
import { AssertionOutcome } from "../domain";
import { ObjectState } from "../types";

export const REQUIRED_CAP: Record<string, string> = {
  right_angle_mark: "geometry2d.perpendicular",
  equal_tick: "geometry2d.equal_length",
  parallel_mark: "geometry2d.parallel",
  angle_mark: "geometry2d.angle_mark"
};

const ENTITY_RE = /^math:entity:([A-Za-z_][A-Za-z0-9_-]*)(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;

function markSubjectsOf(markObj: any, scene: any): string[] | null {
  const ids: string[] = [];
  for (const ref of markObj?.attach_to ?? []) {
    const target = (scene.objects ?? []).find((o: any) => o?.objectId === ref);
    const m = ENTITY_RE.exec(target?.binding?.source ?? "");
    if (!m) return null;
    ids.push(m[1]);
  }
  return ids.length ? ids : null;
}

export function verifyMarks(scene: any, objects: Record<string, ObjectState>, results: AssertionOutcome[]): void {
  for (const obj of scene.objects ?? []) {
    const prim: string = obj?.primitive ?? "";
    const required = REQUIRED_CAP[prim];
    if (!required) continue;

    if (typeof obj?.binding?.source !== "string" || !obj.binding.source.startsWith("math:fact:")) {
      throw makeRuntimeError("E_MATH_ASSERTION", `mark '${obj.objectId}' (${prim}) must bind math:fact:F as the mathematical claim it visualizes`);
    }
    const subjects = markSubjectsOf(obj, scene);
    if (!subjects) {
      throw makeRuntimeError("E_MATH_ASSERTION", `mark '${obj.objectId}' (${prim}) has no resolvable attach_to entity set`);
    }
    const set = new Set(subjects);
    const match = results.find(
      (r) =>
        r.capability === required &&
        r.expectation === "holds" &&
        r.pass &&
        new Set(r.subjects).size === set.size &&
        r.subjects.every((s: string) => set.has(s))
    );
    if (!match) {
      throw makeRuntimeError(
        "E_MATH_ASSERTION",
        `mark '${obj.objectId}' (${prim}) requires a PASS assertion '${required}' over subjects [${[...set].join(", ")}] — mathematical marks are claims, not decoration`
      );
    }
  }
  void objects;
}
