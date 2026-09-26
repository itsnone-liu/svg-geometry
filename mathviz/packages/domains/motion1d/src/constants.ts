export const MOTION1D_ADAPTER_VERSION = "0.1.0";
export const MOTION1D_CAPABILITIES: ReadonlySet<string> = new Set([
  "motion1d.constant_velocity",
  "motion1d.piecewise_constant_velocity",
  "motion1d.meeting_event",
  "motion1d.overtake_event",
  "motion1d.reach_event",
  "motion1d.unit_normalize",
  "motion1d.solve_position"
]);
