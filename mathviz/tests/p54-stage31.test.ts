// P5.4 Stage-3.1 hardening tests (owner-specified H1–H5). All deterministic,
// offline, zero provider dependency (H4 uses an in-memory mock provider).
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { attemptCompileV5, parseProblemSpecV5 } from "../packages/parser/src/parse-v5";
import { auditRepairV5 } from "../packages/parser/src/repair-v5";
import { groundProblemSpec } from "../packages/parser/src/grounding";
import { groundProblemSpecV5 } from "../packages/parser/src/grounding-v5";

const FREEZE = "877bf6dd0ee30d4adca62d79cded0eaf657edf64";
const DATASET = "mathviz/fixtures/parser-bench-v4/cases.json";
const clone = (x: any) => JSON.parse(JSON.stringify(x));

function caseById(id: string): any {
  return JSON.parse(execSync(`git cat-file blob ${FREEZE}:${DATASET}`, { maxBuffer: 64 << 20 }).toString("utf8")).cases.find((c: any) => c.id === id);
}
const fnOf = (s: any) => s.entities.find((e: any) => e.kind === "function");
const eqOf = (s: any) => s.entities.find((e: any) => e.kind === "equation");

// H1 — path-scoped suppression: an independent irrelevant entity's
// E_SOURCE_IRRELEVANT must survive while the label root cause's own derived
// findings are suppressed (with per-{code,path} detail recorded).
describe("Stage-3.1 H1 — suppression is path-scoped, never code-global", () => {
  it("an unrelated irrelevant entity survives; only the root cause's own paths are suppressed", () => {
    const c = caseById("v4_f_08");
    const spec = clone(c.golden);
    delete fnOf(spec).label; // the root cause
    const extra = clone(eqOf(spec)); extra.id = "eq_extra"; // unreachable duplicate -> genuine independent E_SOURCE_IRRELEVANT
    spec.entities.push(extra);
    const att = attemptCompileV5(spec, c.statement);
    const codes = att.errors.map((e) => e.code);
    expect(codes).toContain("E_FUNCTION_DECLARATION_LABEL_MISSING");
    const irrelevant = att.errors.filter((e) => e.code === "E_SOURCE_IRRELEVANT");
    expect(irrelevant.some((e) => e.path === "/entities/eq_extra")).toBe(true); // independent error NOT swallowed
    expect(irrelevant.some((e) => e.path === `/entities/${fnOf(spec).id}`)).toBe(false); // root cause's own IS suppressed
    // suppressed detail is per {code,path}, not just a count
    const items = att.suppressedFindings.items.map((i) => `${i.code}@${i.path}`);
    expect(items.some((x) => x.startsWith("E_SOURCE_IRRELEVANT@/entities/"))).toBe(true);
    expect(att.suppressedFindings.count).toBe(att.suppressedFindings.items.length);
  });
});

// H2 — per-goal implication: a GOAL_BINDING error on one goal must not unlock
// another goal's protection.
describe("Stage-3.1 H2 — goal binding error unlocks only the implicated goal", () => {
  it("the other conforming goal stays protected", () => {
    const c = caseById("v4_f_08");
    const a1 = clone(c.golden);
    delete fnOf(a1).label;
    const eq2 = clone(eqOf(a1)); eq2.id = "eq_two";
    a1.entities.push(eq2);
    const g1 = a1.goals[0];
    a1.goals.push({ goalId: "solve_two", capabilityId: "function2d.solve_equation", inputs: ["entity:eq_two"] });
    const repair = clone(a1);
    repair.goals[0].inputs = [...repair.goals[0].inputs, `entity:${fnOf(repair).id}`]; // destructive edit on the NON-implicated goal
    repair.goals[1].inputs = [`entity:${fnOf(repair).id}`]; // (allowed) edit on the implicated goal
    const active = [{ code: "E_FUNCTION_ZERO_GOAL_BINDING", path: "/goals/solve_two/inputs" }];
    const audit = auditRepairV5(a1, repair, active);
    expect(audit.protected_paths_restored).toContain(`/goals/${g1.goalId}/inputs`);
    expect(audit.protected_paths_restored.some((p) => p.startsWith("/goals/solve_two"))).toBe(false);
    expect(audit.projected_candidate.goals[1].inputs).toEqual([`entity:${fnOf(repair).id}`]); // implicated goal untouched by audit
  });
});

// H3 — protected goal closure: goal deletion, referenced-equation deletion,
// and capabilityId rewrite are all caught.
describe("Stage-3.1 H3 — closure blocks deletion/re-typing bypasses", () => {
  const base = () => {
    const c = caseById("v4_f_08");
    const a1 = clone(c.golden);
    delete fnOf(a1).label;
    return { c, a1, active: attemptCompileV5(a1, c.statement).errors };
  };
  it("deleting the protected goal is projected back wholesale", () => {
    const { a1, active } = base();
    const repair = clone(a1);
    repair.goals = []; // delete-goal bypass
    const audit = auditRepairV5(a1, repair, active);
    expect(audit.verdict).toBe("projected");
    expect(audit.protected_paths_restored).toContain(`/goals/${a1.goals[0].goalId}`);
    expect(audit.projected_candidate.goals.some((g: any) => g.goalId === a1.goals[0].goalId)).toBe(true);
    expect(JSON.stringify(audit.projected_candidate.goals.find((g: any) => g.goalId === a1.goals[0].goalId))).toEqual(JSON.stringify(a1.goals[0]));
  });
  it("deleting the referenced equation entity is projected back", () => {
    const { a1, active } = base();
    const repair = clone(a1);
    repair.entities = repair.entities.filter((e: any) => e.kind !== "equation");
    const audit = auditRepairV5(a1, repair, active);
    expect(audit.verdict).toBe("projected");
    expect(audit.protected_paths_restored).toContain(`/entities/${eqOf(a1).id}`);
    expect(audit.projected_candidate.entities.some((e: any) => e.id === eqOf(a1).id)).toBe(true);
  });
  it("rewriting capabilityId is projected back", () => {
    const { a1, active } = base();
    const repair = clone(a1);
    repair.goals[0].capabilityId = "function2d.plot";
    const audit = auditRepairV5(a1, repair, active);
    expect(audit.verdict).toBe("projected");
    expect(audit.protected_paths_restored).toContain(`/goals/${a1.goals[0].goalId}/capabilityId`);
    expect(audit.projected_candidate.goals[0].capabilityId).toBe("function2d.solve_equation");
  });
});

// H4 — repair call accounting: 1 provider repair request = 1 repair
// diagnostic; the audit projection must not masquerade as a second call.
describe("Stage-3.1 H4 — repair diagnostics count provider calls only", () => {
  it("projection keeps provider repair calls == 1", async () => {
    const c = caseById("v4_f_08");
    const a1 = clone(c.golden); delete fnOf(a1).label;
    const destructive = clone(a1);
    destructive.goals[0].inputs = [...destructive.goals[0].inputs, `entity:${fnOf(destructive).id}`];
    let calls = 0;
    const provider = {
      async generate<T>(request: any): Promise<any> {
        calls++;
        const value = calls === 1 ? a1 : destructive;
        return { value, usage: { input_tokens: 10, output_tokens: 10 }, diagnostics: { raw_text: JSON.stringify(value), model: "mock", finish_reason: "stop", request_id: `mock-${calls}` } };
      },
    };
    const outcome = await parseProblemSpecV5(provider as any, c.statement);
    expect(calls).toBe(2); // 1 spec + 1 repair provider request
    expect(outcome.repairUsed).toBe(true);
    expect(outcome.repairAudit?.verdict).toBe("projected");
    expect(outcome.repairAudit?.projected_gates).not.toBeNull();
    const repairDiagnostics = outcome.diagnostics.filter((d) => d.stage === "repair");
    expect(repairDiagnostics).toHaveLength(1); // H4: audit projection is NOT a second repair diagnostic
    expect(outcome.repairAudit?.protected_paths_restored).toEqual([`/goals/${a1.goals[0].goalId}/inputs`]);
  });
});

// H5 — non-x power-form grounding: variable match enforced; a
// wrong-variable equation must NOT be released by the corrected special case.
// The scenario uses a full-width superscript (y²) so the AST token "2" has no
// ASCII digit source in the cited slice: the frozen verifier must reject
// (token absent; its quadratic special case is dead code), while the Stage-2D
// corrected path releases the equation verdict via canonical-AST power-form
// evidence + actual-declared-variable equality.
describe("Stage-3.1 H5 — non-x variable power-form grounding", () => {
  const statement = "定义 h(y) = y² - 4，求 h(y) 的零点。";
  const expr = { t: "app", op: "-", args: [
    { t: "app", op: "^", args: [{ t: "sym", name: "y" }, { t: "num", v: { kind: "int", value: "2" } }] },
    { t: "num", v: { kind: "int", value: "4" } },
  ] };
  const decl = "定义 h(y) = y² - 4";
  const build = (eqVariable: string) => ({
    statement, domain: "function2d",
    entities: [
      { id: "fn_h", kind: "function", label: "h", props: { variable: "y", expr }, provenance: { span: { start: 0, end: decl.length, text: decl } } },
      { id: "eq_h", kind: "equation", props: { capability_id: "function2d.solve_equation", variable: eqVariable, lhs: expr, rhs: { t: "num", v: { kind: "int", value: "0" } } }, provenance: { span: { start: 0, end: statement.length, text: statement } } },
    ],
    goals: [{ goalId: "solve_h", capabilityId: "function2d.solve_equation", inputs: ["entity:eq_h"] }],
  });
  it("matching-variable h(y)=y²-4 case: corrected special case releases the equation verdict the frozen path rejects", () => {
    const spec = build("y");
    const base = groundProblemSpec(spec, statement);
    const eqFinding = base.findings.find((f: any) => f.path === "/entities/eq_h");
    expect(eqFinding?.grounded).toBe(false); // frozen verdict: AST token '2' has no source; special case is dead code
    const v5 = groundProblemSpecV5(spec, statement);
    const v5Finding = v5.findings.find((f: any) => f.path === "/entities/eq_h");
    expect(v5Finding?.grounded).toBe(true); // corrected: AST power evidence + variable match + declared anchor
    expect((v5 as any).p54_stage2d_corrections).toBe(1);
    expect(v5.semanticGroundedCount).toBe(base.semanticGroundedCount + 1);
  });
  it("wrong-variable equation is NOT released by the special case", () => {
    const spec = build("x"); // equation declares variable x, function declares y
    const base = groundProblemSpec(spec, statement);
    expect(base.findings.find((f: any) => f.path === "/entities/eq_h")?.grounded).toBe(false);
    const v5 = groundProblemSpecV5(spec, statement);
    expect(v5.findings.find((f: any) => f.path === "/entities/eq_h")?.grounded).toBe(false);
    expect((v5 as any).p54_stage2d_corrections).toBe(0);
  });
});
