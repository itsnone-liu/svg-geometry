// MathViz P1 Runtime — frozen type surface.
// Self-contained by design: no node builtins, no contracts/Ajv imports, so the
// SAME source runs under tsx/vitest (node) and inside the browser bundle.

export type VizErrorCode =
  | "E_SCHEMA"
  | "E_PROVENANCE"
  | "E_CAPABILITY_UNSUPPORTED"
  | "E_MATH_CONSTRAINT"
  | "E_MATH_ASSERTION"
  | "E_BINDING"
  | "E_SCENE_COVERAGE"
  | "E_LAYOUT"
  | "E_NONDETERMINISTIC"
  | "E_RENDER";

export interface CameraState {
  zoom: number;
  center_on: string | null;
}

export interface CaptionState {
  text: string;
  started_at: number;
}

export interface ObjectState {
  objectId: string;
  visible: boolean;
  highlighted: boolean;
  dimmed: boolean;
  /** Resolved math value for this object's binding at the current time
   *  (null when the binding cannot be evaluated, e.g. runtime value outside
   *  any model-time mapping window). */
  resolvedBinding: unknown;
  presentation: {
    primitive: string;
    label?: string;
    text?: string;
    style?: Record<string, unknown>;
  };
}

export interface RuntimeState {
  presentationTime: number;
  modelTime: number | null;
  objects: Record<string, ObjectState>;
  camera: CameraState;
  caption: CaptionState | null;
  digest: string;
  /** P2.1: digest of complete domain semantic state (geometry/motion), null
   *  when no domain adapter ran. Included in RuntimeState.digest whenever a
   *  snapshot exists; P1 no-snapshot digest vectors remain byte-identical. */
  domainDigest?: string | null;
}

export interface PlayerController {
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  setFrame(frame: number): void;
  getState(): RuntimeState;
  /** Advance the internal clock by dt seconds (only moves while playing).
   *  Node-side tests drive this; the browser player drives it from rAF. */
  tick(dt: number): RuntimeState;
  readonly playing: boolean;
  readonly currentTime: number;
}

export interface CompiledRuntime {
  readonly projectDigest: string;
  readonly duration: number;
  readonly fps: number;
  stateAt(presentationTime: number): RuntimeState;
  stateAtFrame(frame: number): RuntimeState;
  createPlayer(): PlayerController;
}
