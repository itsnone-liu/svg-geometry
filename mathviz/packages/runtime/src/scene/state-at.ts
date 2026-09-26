// Scene state assembly at one presentation time. Pure function of
// (compiled project, time): every call rebuilds the full RuntimeState.

import { evalTimeline } from "../timeline/evaluate";
import { CompiledTimeline } from "../timeline/compile";
import { buildEnv, resolveSource } from "../bindings/resolve";
import { assertNoTransform } from "../bindings/transform";
import { ObjectState, RuntimeState } from "../types";
import { digestOf } from "../digest";

export interface SceneIR {
  sceneId?: string;
  viewport?: { width?: number; height?: number; margin?: number[] };
  objects?: any[];
  bindings?: any[];
}

export function stateAt(math: any, scene: SceneIR, ct: CompiledTimeline, t: number): RuntimeState {
  const tev = evalTimeline(ct, t);
  const env = buildEnv(math, tev.modelTime);

  const objects: Record<string, ObjectState> = {};
  for (const obj of scene.objects ?? []) {
    const oid = obj?.objectId;
    if (typeof oid !== "string") continue;
    const flags = tev.flags[oid] ?? { visible: true, highlighted: false, dimmed: false };
    let resolvedBinding: unknown = null;
    if (obj.binding && typeof obj.binding.source === "string") {
      assertNoTransform(obj.binding);
      resolvedBinding = resolveSource(math, obj.binding.source, env);
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

  const partial = {
    presentationTime: t,
    modelTime: tev.modelTime,
    objects,
    camera: tev.camera,
    caption: tev.caption
  };
  return { ...partial, digest: digestOf(partial) };
}
