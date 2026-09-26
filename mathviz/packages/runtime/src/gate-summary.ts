export type GateStatus = "PASS" | "FAIL" | "SKIP" | "INCOMPLETE";
export type GateSummary = "ALL GREEN" | "INCOMPLETE" | "FAILURES PRESENT";

export interface GateSummaryResult {
  summary: GateSummary;
  exitCode: 0 | 1;
}

/**
 * Freeze semantics for required parity/oracle gates:
 * - ALL GREEN only when every gate is PASS.
 * - G10 browser parity is required (P2.1): missing Chrome is INCOMPLETE and
 *   non-zero in freeze mode; an explicitly allowed G10-only SKIP remains
 *   INCOMPLETE (never green).
 * - G13 SymPy oracle is required when present (P4): python/sympy missing or
 *   != pinned is INCOMPLETE (freeze-required), never a silent SKIP; an
 *   explicitly allowed G13 SKIP (ALLOW_SYMPY_SKIP=1) stays INCOMPLETE.
 * - A SKIP in any other gate is not covered by either allowance.
 */
export function summarizeGates(
  gates: Array<{ gate: string; status: string }>,
  allowBrowserSkip: boolean,
  opts?: { allowSympySkip?: boolean }
): GateSummaryResult {
  const allowSympySkip = opts?.allowSympySkip ?? false;
  const required = new Set<string>(["G10_cross_output_consistency"]);
  if (gates.some((g) => g.gate === "G13_function_sympy_oracle")) {
    required.add("G13_function_sympy_oracle");
  }
  for (const name of required) {
    if (gates.filter((g) => g.gate === name).length !== 1) {
      return { summary: "FAILURES PRESENT", exitCode: 1 };
    }
  }
  if (gates.length > 0 && gates.every((g) => g.status === "PASS")) {
    return { summary: "ALL GREEN", exitCode: 0 };
  }
  const others = gates.filter((g) => !required.has(g.gate));
  if (!others.every((g) => g.status === "PASS")) {
    return { summary: "FAILURES PRESENT", exitCode: 1 };
  }
  let incompleteExit1 = false;
  let incompleteExit0 = false;
  for (const name of required) {
    const rs = gates.filter((g) => g.gate === name);
    if (rs.length !== 1) return { summary: "FAILURES PRESENT", exitCode: 1 };
    const st = rs[0].status;
    if (st === "PASS") continue;
    if (st === "INCOMPLETE") incompleteExit1 = true;
    else if (st === "SKIP" && ((name === "G10_cross_output_consistency" && allowBrowserSkip) || (name === "G13_function_sympy_oracle" && allowSympySkip))) incompleteExit0 = true;
    else return { summary: "FAILURES PRESENT", exitCode: 1 };
  }
  if (incompleteExit1) return { summary: "INCOMPLETE", exitCode: 1 };
  if (incompleteExit0) return { summary: "INCOMPLETE", exitCode: 0 };
  return { summary: "INCOMPLETE", exitCode: 1 };
}
