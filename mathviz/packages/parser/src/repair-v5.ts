// P5.4 Stage-2B — deterministic repair monotonicity enforcement.
// Repair may fix implicated paths; it may NOT rewrite already-conforming
// unrelated paths. Enforcement is deterministic, never prompt-only.
//
// Frozen invariant (owner ruling): if an A1 solve_equation goal already has
// inputs.length >= 1 with inputs[0] referencing an equation entity, AND the
// active error set does not implicate that goal's binding (no
// E_FUNCTION_ZERO_GOAL_BINDING / E_FUNCTION_ZERO_GOAL_OVERREFERENCE / a path
// under that goal), then after repair the goal's inputs must stay
// byte-identical (JSON.stringify equality). Violations are NOT silently
// accepted: the protected fields are projected back from A1 and the full
// audit (model_repair_candidate / projected_candidate /
// protected_paths_restored) is recorded in the outcome.
export interface RepairAuditResult {
  verdict: "allowed" | "projected";
  /** The candidate to compile after audit (=== model candidate when allowed). */
  projected_candidate: any;
  /** The model's raw repair candidate (never mutated). */
  model_repair_candidate: any;
  /** Protected paths restored from A1, e.g. ["/goals/solve_z/inputs"]. */
  protected_paths_restored: string[];
  /** Human-readable audit notes for diagnostics. */
  audit_notes: string[];
}

function refId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(?:math:)?entity:(.+)$/.exec(value);
  return m ? m[1] : value || null;
}

function goalImplicated(errors: Array<{ code: string; path?: string }>, goalId: string): boolean {
  return errors.some((e) =>
    e.code === "E_FUNCTION_ZERO_GOAL_BINDING"
    || e.code === "E_FUNCTION_ZERO_GOAL_OVERREFERENCE"
    || (typeof e.path === "string" && e.path.startsWith(`/goals/${goalId}`)));
}

/** Deterministic mutation audit over the model's repair candidate. */
export function auditRepairV5(a1Candidate: any, repairCandidate: any, activeErrors: Array<{ code: string; path?: string }>): RepairAuditResult {
  const notes: string[] = [];
  if (!a1Candidate || typeof a1Candidate !== "object" || !repairCandidate || typeof repairCandidate !== "object") {
    return { verdict: "allowed", projected_candidate: repairCandidate, model_repair_candidate: repairCandidate, protected_paths_restored: [], audit_notes: ["audit skipped: A1 or repair candidate is not an object"] };
  }
  const projected = JSON.parse(JSON.stringify(repairCandidate));
  const restored: string[] = [];

  const a1Entities = new Map<string, any>((Array.isArray(a1Candidate.entities) ? a1Candidate.entities : []).map((e: any) => [e?.id, e]));
  const a1Goals = Array.isArray(a1Candidate.goals) ? a1Candidate.goals : [];
  const projectedGoals = Array.isArray(projected.goals) ? projected.goals : [];
  const projectedEntitiesById = new Map<string, any>((Array.isArray(projected.entities) ? projected.entities : []).map((e: any) => [e?.id, e]));

  for (const a1Goal of a1Goals) {
    if (a1Goal?.capabilityId !== "function2d.solve_equation") continue;
    const inputs: string[] = Array.isArray(a1Goal?.inputs) ? a1Goal.inputs : [];
    if (inputs.length < 1) continue; // invariant precondition unmet: nothing to protect
    const first = refId(inputs[0]);
    const target = a1Entities.get(first ?? "");
    if (!target || target?.kind !== "equation") continue; // inputs[0] is not an equation: unprotected
    if (goalImplicated(activeErrors, a1Goal.goalId)) continue; // binding itself implicated: repair may touch it
    const repairedGoal = projectedGoals.find((g: any) => g?.goalId === a1Goal.goalId);
    if (!repairedGoal) continue;
    const repairedInputs = Array.isArray(repairedGoal?.inputs) ? repairedGoal.inputs : null;
    if (JSON.stringify(repairedInputs) !== JSON.stringify(inputs)) {
      restored.push(`/goals/${a1Goal.goalId}/inputs`);
      repairedGoal.inputs = JSON.parse(JSON.stringify(inputs));
      notes.push(`goal '${a1Goal.goalId}' inputs were conforming (inputs[0] -> equation '${first}') and not implicated by any active error; model mutation ${JSON.stringify(repairedInputs)} rejected, A1 value restored`);
    }
  }

  // Entity-kind integrity guard: an equation entity referenced as inputs[0] by
  // a protected goal must not have its kind rewritten either (mutation could
  // otherwise sidestep the projection through the entity table).
  for (const a1Entity of a1Entities.values()) {
    if (a1Entity?.kind !== "equation") continue;
    const pe = projectedEntitiesById.get(a1Entity.id);
    if (pe && pe?.kind !== a1Entity.kind) {
      restored.push(`/entities/${a1Entity.id}/kind`);
      pe.kind = a1Entity.kind;
      notes.push(`entity '${a1Entity.id}' kind rewritten by repair; restored to '${a1Entity.kind}'`);
    }
  }

  return {
    verdict: restored.length ? "projected" : "allowed",
    projected_candidate: projected,
    model_repair_candidate: repairCandidate,
    protected_paths_restored: restored,
    audit_notes: notes,
  };
}
