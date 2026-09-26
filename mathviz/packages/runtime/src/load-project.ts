// Load a frozen compiled project for runtime execution.
// The project is expected to have passed the P0 gates already; the runtime
// re-checks only the invariants it directly depends on (schema versions,
// timeline semantics via compileTimeline, no fs / no Ajv by design so this
// same code runs in the browser bundle).

import { makeRuntimeError } from "./errors";
import { compileTimeline, CompiledTimeline } from "./timeline/compile";
import { digestOf } from "./digest";
import { DomainAdapter, DomainContext, DomainProgram } from "./domain";

export interface RuntimeOptions {
  /** Domain adapters to activate, keyed by math.domain (P2 extension point). */
  domains?: Record<string, DomainAdapter>;
}

export interface LoadedProject {
  raw: any;
  math: any;
  scene: any;
  timeline: any;
  compiled: CompiledTimeline;
  projectDigest: string;
  duration: number;
  fps: number;
  domain: DomainContext | null;
}

const PROJECT_SCHEMA = "mathviz.project/v1";
const MATH_SCHEMA = "mathviz.math/v1";
const SCENE_SCHEMA = "mathviz.scene/v1";
const TIMELINE_SCHEMA = "mathviz.timeline/v1";

export function loadProject(doc: any, opts?: RuntimeOptions): LoadedProject {
  if (!doc || typeof doc !== "object") throw makeRuntimeError("E_SCHEMA", "project document missing");
  const m = doc.manifest ?? {};
  if (m.schema_version !== PROJECT_SCHEMA) {
    throw makeRuntimeError("E_SCHEMA", `manifest.schema_version must be '${PROJECT_SCHEMA}' (got '${m.schema_version}')`);
  }
  if (typeof m.engine_version !== "string" || m.engine_version.length === 0) {
    throw makeRuntimeError("E_SCHEMA", "manifest.engine_version missing");
  }
  if (!m.domain_versions || typeof m.domain_versions !== "object") {
    throw makeRuntimeError("E_SCHEMA", "manifest.domain_versions missing");
  }
  if (!m.adapter_versions || typeof m.adapter_versions !== "object") {
    throw makeRuntimeError("E_SCHEMA", "manifest.adapter_versions missing");
  }

  const math = doc.math;
  if (!math || math.schemaVersion !== MATH_SCHEMA) {
    throw makeRuntimeError("E_SCHEMA", `math.schemaVersion must be '${MATH_SCHEMA}'`);
  }
  const scene = doc.scene;
  if (!scene || scene.schemaVersion !== SCENE_SCHEMA) {
    throw makeRuntimeError("E_SCHEMA", `scene.schemaVersion must be '${SCENE_SCHEMA}'`);
  }
  const timeline = doc.timeline;
  if (!timeline || timeline.schemaVersion !== TIMELINE_SCHEMA) {
    throw makeRuntimeError("E_SCHEMA", `timeline.schemaVersion must be '${TIMELINE_SCHEMA}'`);
  }

  const compiled = compileTimeline(timeline);

  // Domain program compilation/validation runs ONCE here; the per-frame path
  // only executes the verified program. The pinned upstream kernel is kept in
  // the adapter package and exercised by the separate build-time G11 oracle.
  let domain: DomainContext | null = null;
  const adapter = opts?.domains?.[String(math?.domain ?? "")];
  const hasCompiledDomainEntities = (math?.entities ?? []).some((e: any) => e?.kind === "dynamic_point" || typeof e?.props?.capability_id === "string");
  if (!adapter && hasCompiledDomainEntities) {
    throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `domain '${math?.domain}' contains compiled constructions but no DomainAdapter was registered`);
  }
  if (adapter) {
    const program: DomainProgram = adapter.compile(math);
    domain = { adapter, program };
  }

  return {
    raw: doc,
    math,
    scene,
    timeline,
    compiled,
    projectDigest: digestOf(doc),
    duration: compiled.duration,
    fps: compiled.fps,
    domain
  };
}
