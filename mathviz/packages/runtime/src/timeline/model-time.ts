// presentation_time -> model_time evaluation.
// Frozen semantics (P1):
//   - windows are half-open [from, to); the LAST window is closed [from, to]
//     so a shared boundary is not double-hit
//   - outside every window: modelTime = null (presentation-only region)
//   - inside: linear map  m = mfrom + (t - from) / (to - from) * (mto - mfrom)
// Overlapping windows are rejected at compile time (E_NONDETERMINISTIC).

export interface ModelWindow {
  from: number;
  to: number;
  modelFrom: number;
  modelTo: number;
}

export function modelTimeAt(windows: ModelWindow[], t: number): number | null {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const isLast = i === windows.length - 1;
    const inWindow = t >= w.from && (t < w.to || (isLast && t <= w.to));
    if (inWindow) {
      const u = (t - w.from) / (w.to - w.from);
      return w.modelFrom + u * (w.modelTo - w.modelFrom);
    }
  }
  return null;
}
