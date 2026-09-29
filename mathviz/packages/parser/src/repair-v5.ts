// P5.4 Stage-2B / Stage-3.1 — deterministic repair monotonicity enforcement.
// Repair may fix implicated paths; it may NOT rewrite already-conforming
// unrelated paths. Enforcement is deterministic, never prompt-only.
//
// Stage-3.1 PROTECTED GOAL CLOSURE (owner hardening 2026-09-29): for every A1
// solve_equation goal that is already conforming AND not implicated by any
// active error, ALL of the following are protected from repair mutation:
//   - goal existence (deleting the goal is not a bypass);
//   - goalId / capabilityId / inputs (byte-identical survival);
//   - existence and equation kind of the entity referenced by inputs[0].
// "Implicated" is located per-goal by error PATH (`/goals/<goalId>` prefix),
// never by error code alone — a GOAL_BINDING error on one goal must not
// unlock another goal's protection. As a conservative fallback, a
// goal-binding-class error with NO goal-locating path unlocks all goals
// (fail-open only where we cannot attribute, never silently).
// Violations are NOT silently accepted: protected fields are projected back
// from A1 and the full audit (model_repair_candidate / projected_candidate /
// protected_paths_restored / audit_notes) is recorded by the pipeline.
export interface RepairAuditResult {
  verdict: "allowed" | "projected";
  /** The candidate to compile after audit (=== model candidate when allowed). */
  projected_candidate: any;
  /** The model's raw repair candidate (never mutated). */
  model_repair_candidate: any;
  /** Protected paths restored from A1 (goals, inputs, capabilityIds,
   * referenced equation entities). */
  protected_paths_restored: string[];
  /** Human-readable audit notes for diagnostics. */
  audit_notes: string[];
}

function refId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(?:math:)?entity:(.+)$/.exec(value);
  return m ? m[1] : value || null;
}

/** Per-goal implication: PATH-LOCATED (never code-global). An error implicates
 * a goal only when its path points into that goal. Goal-binding-class errors
 * without any goal-locating path are attributed to ALL goals (conservative). */
function goalImplicated(errors: Array<{ code: string; path?: string }>, goalId: string): boolean {
  return errors.some((e) => {
    if (e.code === "E_FUNCTION_ZERO_GOAL_BINDING" || e.code === "E_FUNCTION_ZERO_GOAL_OVERREFERENCE") {
      if (typeof e.path !== "string" || e.path === "/goals" || !/^\/goals\/[^/]+/.test(e.path)) return true; // unattributable: unlock all
    }
    return typeof e.path === "string" && e.path.startsWith(`/goals/${goalId}`);
  });
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
  const a1Goals: any[] = Array.isArray(a1Candidate.goals) ? a1Candidate.goals : [];
  if (!Array.isArray(projected.goals)) projected.goals = [];

  for (const a1Goal of a1Goals) {
    if (a1Goal?.capabilityId !== "function2d.solve_equation") continue;
    const goalId = a1Goal.goalId;
    const inputs: string[] = Array.isArray(a1Goal?.inputs) ? a1Goal.inputs : [];
    if (inputs.length < 1) continue; // invariant precondition unmet: nothing to protect
    const first = refId(inputs[0]);
    const target = a1Entities.get(first ?? "");
    if (!target || target?.kind !== "equation") continue; // inputs[0] is not an equation: unprotected
    if (goalImplicated(activeErrors, goalId)) continue; // binding itself implicated: repair may touch it

    // --- protected goal closure ---
    let repairedGoal = projected.goals.find((g: any) => g?.goalId === goalId);
    if (!repairedGoal) {
      // deleting the goal is not a bypass: restore it wholesale from A1
      projected.goals.push(JSON.parse(JSON.stringify(a1Goal)));
      restored.push(`/goals/${goalId}`);
      notes.push(`protected goal '${goalId}' was deleted by repair; restored wholesale from A1`);
      repairedGoal = projected.goals[projected.goals.length - 1];
    }
    if (repairedGoal?.capabilityId !== a1Goal.capabilityId) {
      restored.push(`/goals/${goalId}/capabilityId`);
      repairedGoal.capabilityId = a1Goal.capabilityId;
      notes.push(`protected goal '${goalId}' capabilityId rewritten by repair; A1 value restored`);
    }
    const repairedInputs = Array.isArray(repairedGoal?.inputs) ? repairedGoal.inputs : null;
    if (JSON.stringify(repairedInputs) !== JSON.stringify(inputs)) {
      restored.push(`/goals/${goalId}/inputs`);
      repairedGoal.inputs = JSON.parse(JSON.stringify(inputs));
      notes.push(`goal '${goalId}' inputs were conforming (inputs[0] -> equation '${first}') and not implicated by any active error; model mutation ${JSON.stringify(repairedInputs)} rejected, A1 value restored`);
    }
    // referenced equation entity: existence + kind (deleting or re-typing it
    // would sidestep the inputs projection through the entity table)
    if (!Array.isArray(projected.entities)) projected.entities = [];
    let pe = projected.entities.find((e: any) => e?.id === first);
    if (!pe) {
      projected.entities.push(JSON.parse(JSON.stringify(target)));
      restored.push(`/entities/${first}`);
      notes.push(`equation entity '${first}' referenced by protected goal '${goalId}' was deleted by repair; restored from A1`);
      pe = projected.entities[projected.entities.length - 1];
    } else if (pe?.kind !== "equation") {
      restored.push(`/entities/${first}/kind`);
      pe.kind = "equation";
      notes.push(`entity '${first}' referenced by protected goal '${goalId}' had its kind rewritten; restored to 'equation'`);
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
