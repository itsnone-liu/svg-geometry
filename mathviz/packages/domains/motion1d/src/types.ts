import type { DomainSnapshot } from "../../../runtime/src/domain";

/** JSON-safe exact rational; bigint arithmetic stays in the compiler/kernel. */
export interface ExactRational {
  kind: "rational";
  p: string;
  q: string;
}

export interface MotionSegment {
  start: ExactRational;
  end: ExactRational | null;
  startPosition: ExactRational;
  velocity: ExactRational;
}

export interface MotionBodyProgram {
  id: string;
  initialPosition: ExactRational;
  segments: MotionSegment[];
}

export type MotionEventKind =
  | "motion1d.meeting_event"
  | "motion1d.overtake_event"
  | "motion1d.reach_event";

export interface SolvedMotionEvent {
  eventId: string;
  capabilityId: MotionEventKind;
  participants: string[];
  time: ExactRational;
  position: ExactRational;
}

export interface CompiledMotionAssertion {
  assertionId: string;
  capabilityId: string;
  subjects: string[];
  expectation: "holds" | "forbidden";
  expected: ExactRational;
}

export interface VerifiedMotionProgram {
  domain: "motion1d";
  adapterVersion: string;
  bodies: MotionBodyProgram[];
  events: SolvedMotionEvent[];
  assertions: CompiledMotionAssertion[];
  markers: Array<{ id: string; eventId: string }>;
  digest: string;
}

export interface MotionSnapshotEntity {
  [key: string]: unknown;
  kind: "body" | "event";
  eventId?: string;
  capabilityId?: string;
  time?: number;
  position?: number;
  velocity?: number;
  active?: boolean;
  segmentIndex?: number | null;
}

export type MotionSnapshotBody = MotionSnapshotEntity;

export interface MotionSnapshot extends DomainSnapshot {
  entities: Record<string, MotionSnapshotEntity>;
}
