export type GateStatus = "PASS" | "FAIL" | "SKIP" | "INCOMPLETE";
export type GateSummary = "ALL GREEN" | "INCOMPLETE" | "FAILURES PRESENT";

export interface GateSummaryResult {
  summary: GateSummary;
  exitCode: 0 | 1;
}

/**
 * Freeze semantics for required browser parity:
 * - ALL GREEN only when every required gate is PASS.
 * - Missing G10 Chrome is INCOMPLETE and non-zero in freeze mode.
 * - An explicitly allowed G10-only SKIP remains INCOMPLETE (never green).
 * - A SKIP in any other gate is not covered by ALLOW_BROWSER_SKIP.
 */
export function summarizeGates(
  gates: Array<{ gate: string; status: string }>,
  allowBrowserSkip: boolean
): GateSummaryResult {
  const g10 = gates.filter((g) => g.gate === "G10_cross_output_consistency");
  if (gates.length > 0 && g10.length === 1 && gates.every((g) => g.status === "PASS")) {
    return { summary: "ALL GREEN", exitCode: 0 };
  }
  const others = gates.filter((g) => g.gate !== "G10_cross_output_consistency");
  const otherGatesPass = others.every((g) => g.status === "PASS");

  if (g10.length === 1 && g10[0].status === "INCOMPLETE" && otherGatesPass) {
    return { summary: "INCOMPLETE", exitCode: 1 };
  }
  if (
    allowBrowserSkip &&
    g10.length === 1 &&
    g10[0].status === "SKIP" &&
    otherGatesPass
  ) {
    return { summary: "INCOMPLETE", exitCode: 0 };
  }
  return { summary: "FAILURES PRESENT", exitCode: 1 };
}
