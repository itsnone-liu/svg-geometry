// Scene state assembly at one presentation time. Pure function of
// (compiled project, time): every call rebuilds the full RuntimeState.
//
// P2 pipeline inside one evaluation:
//   presentation t -> timeline flags -> env (model time)
//     -> domain adapter evaluate (when registered) -> DomainSnapshot
//     -> G5: predicate assertions + verified marks (E_MATH_ASSERTION)
//     -> binding resolution (snapshot first, static fallback)
//     -> RuntimeState digest

import { evalTimeline } from "../timeline/evaluate";
import { CompiledTimeline } from "../timeline/compile";
import { buildEnv, resolveSource } from "../bindings/resolve";
import { applyBindingTransform } from "../bindings/transform";
import { makeRuntimeError } from "../errors";
import { ObjectState, RuntimeState } from "../types";
import { digestOf } from "../digest";
import { AssertionOutcome, DomainContext, DomainSnapshot } from "../domain";
import { verifyMarks } from "./verify-marks";

export interface SceneIR {
  sceneId?: string;
  viewport?: { width?: number; height?: number; margin?: number[] };
  objects?: any[];
  bindings?: any[];
}

export function stateAt(math: any, scene: SceneIR, ct: CompiledTimeline, t: number, domain?: DomainContext | null): RuntimeState {
  const tev = evalTimeline(ct, t);
  const env = buildEnv(math, tev.modelTime);

  // ---- domain evaluation (geometry2d today) ----
  let snapshot: DomainSnapshot | null = null;
  let assertionResults: AssertionOutcome[] = [];
  if (domain) {
    const resolveBinding = (source: string): unknown => resolveSource(math, source, env);
    snapshot = domain.adapter.evaluate(domain.program, {
      modelTime: tev.modelTime,
      env,
      resolveBinding
    });
    assertionResults = domain.adapter.assert(domain.program, snapshot);

    // G5: any violated expectation is fatal — the renderer must not continue.
    for (const r of assertionResults) {
      const violated = r.expectation === "holds" ? !r.pass : r.pass;
      if (violated) {
        throw makeRuntimeError(
          "E_MATH_ASSERTION",
          `assertion '${r.assertion_id}' (${r.capability}) expected ${r.expectation}, evaluated ${r.pass ? "PASS" : "FAIL"}${r.detail ? `: ${r.detail}` : ""}`
        );
      }
    }
  }

  const objects: Record<string, ObjectState> = {};
  for (const obj of scene.objects ?? []) {
    const oid = obj?.objectId;
    if (typeof oid !== "string") continue;
    const flags = tev.flags[oid] ?? { visible: true, highlighted: false, dimmed: false };
    let resolvedBinding: unknown = null;
    if (obj.binding && typeof obj.binding.source === "string") {
      resolvedBinding = applyBindingTransform(obj.binding, resolveSource(math, obj.binding.source, env, snapshot));
    }
    objects[oid] = {
      objectId: oid,
      visible: flags.visible,
      highlighted: flags.highlighted,
      dimmed: flags.dimmed,
      resolvedBinding,
      presentation: {
        primitive: obj.primitive,
        label: obj.label,
        text: obj.text,
        style: obj.style
      }
    };
  }

  // G5 verified marks: «数学标记不是装饰，而是数学声明»
  if (domain && snapshot) {
    verifyMarks(scene, objects, assertionResults);
  }

  const partial = {
    presentationTime: t,
    modelTime: tev.modelTime,
    objects,
    camera: tev.camera,
    caption: tev.caption
  };
  // Semantic state includes the complete domain snapshot, even when some
  // domain entities are not currently bound into Scene. With no snapshot the
  // exact P1 payload remains unchanged, preserving every P1 known vector.
  const semanticState = snapshot ? { ...partial, domainDigest: snapshot.digest } : partial;
  return {
    ...semanticState,
    digest: digestOf(semanticState),
    domainDigest: snapshot ? snapshot.digest : null
  };
}
