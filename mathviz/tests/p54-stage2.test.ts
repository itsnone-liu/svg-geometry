// P5.4 Stage-2 regression tests (2A identity contract, 2B repair
// monotonicity, 2C over-reference detector, 2D grounding correction).
// Real-shape fixtures are derived from the frozen v4 dataset golden specs.
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { checkIdentityV5 } from "../packages/parser/src/identity-v5";
import { auditRepairV5 } from "../packages/parser/src/repair-v5";
import { attemptCompileV5 } from "../packages/parser/src/parse-v5";
import { groundProblemSpec } from "../packages/parser/src/grounding";
import { groundProblemSpecV5 } from "../packages/parser/src/grounding-v5";

const FREEZE = "877bf6dd0ee30d4adca62d79cded0eaf657edf64";
const DATASET = "mathviz/fixtures/parser-bench-v4/cases.json";

function frozenDataset(): any {
  return JSON.parse(execSync(`git cat-file blob ${FREEZE}:${DATASET}`, { maxBuffer: 64 << 20 }).toString("utf8"));
}
function caseById(id: string) { return frozenDataset().cases.find((c: any) => c.id === id); }
const clone = (x: any) => JSON.parse(JSON.stringify(x));

function fnEntity(spec: any) { return spec.entities.find((e: any) => e.kind === "function"); }
function eqEntity(spec: any) { return spec.entities.find((e: any) => e.kind === "equation"); }

describe("P5.4 Stage-2A — named-function identity contract", () => {
  it("golden spec with canonical label: no identity findings", () => {
    const c = caseById("v4_f_08");
    const r = checkIdentityV5(clone(c.golden), c.statement);
    expect(r.findings).toHaveLength(0);
    expect(r.labelMissing).toBeNull();
    expect(r.resolved.functionEntity).toBeTruthy();
  });

  it("missing label yields EXACTLY E_FUNCTION_DECLARATION_LABEL_MISSING at /entities/<id>/label", () => {
    const c = caseById("v4_f_08");
    const spec = clone(c.golden);
    const fn = fnEntity(spec);
    delete fn.label; // the historical A1 shape: identity carried only by id
    const r = checkIdentityV5(spec, c.statement);
    expect(r.labelMissing).toEqual({ entityId: fn.id, declaredName: "z" });
    expect(r.findings.map((f) => f.code)).toEqual(["E_FUNCTION_DECLARATION_LABEL_MISSING"]);
    expect(r.findings[0].path).toBe(`/entities/${fn.id}/label`);
    expect(r.findings[0].repair_hint).toMatch(/Set this function entity's label/);
    expect(r.findings[0].repair_hint).toMatch(/Do not modify goal\.inputs/);
  });

  it("a non-canonical label (id-like) is also flagged", () => {
    const c = caseById("v4_f_08");
    const spec = clone(c.golden);
    fnEntity(spec).label = "func_z";
    const r = checkIdentityV5(spec, c.statement);
    expect(r.findings.map((f) => f.code)).toEqual(["E_FUNCTION_DECLARATION_LABEL_MISSING"]);
  });
});

describe("P5.4 Stage-2C — goal-input over-reference detector", () => {
  const overReferenceShapes = [
    ["entity:eq", "entity:fn"],
    ["entity:fn", "entity:eq"],
    ["entity:eq", "entity:eq2"],
    ["entity:eq", "entity:other"],
  ] as const;
  for (const inputs of overReferenceShapes) {
    it(`inputs ${JSON.stringify(inputs)} FAIL with E_FUNCTION_ZERO_GOAL_OVERREFERENCE`, () => {
      const c = caseById("v4_f_08");
      const spec = clone(c.golden);
      const eq = eqEntity(spec);
      const fn = fnEntity(spec);
      spec.entities.push({ id: "eq2", kind: "equation", props: clone(eq.props), provenance: clone(eq.provenance) });
      spec.entities.push({ id: "other", kind: "point", props: {}, provenance: clone(fn.provenance) });
      spec.goals[0].inputs = inputs.map((x) => x.replace("eq2", "eq2").replace("eq", eq.id).replace("fn", fn.id).replace("other", "other"));
      const r = checkIdentityV5(spec, c.statement);
      expect(r.findings.some((f) => f.code === "E_FUNCTION_ZERO_GOAL_OVERREFERENCE")).toBe(true);
    });
  }
  it("exactly [equation] stays clean; [function] alone stays E_FUNCTION_ZERO_GOAL_BINDING", () => {
    const c = caseById("v4_f_08");
    const okSpec = clone(c.golden);
    const ok = checkIdentityV5(okSpec, c.statement);
    expect(ok.findings.some((f) => f.code.startsWith("E_FUNCTION_ZERO_GOAL"))).toBe(false);
    const fnSpec = clone(c.golden);
    fnSpec.goals[0].inputs = [`entity:${fnEntity(fnSpec).id}`];
    const fnOnly = checkIdentityV5(fnSpec, c.statement);
    expect(fnOnly.findings.some((f) => f.code === "E_FUNCTION_ZERO_GOAL_BINDING")).toBe(true);
    expect(fnOnly.findings.some((f) => f.code === "E_FUNCTION_ZERO_GOAL_OVERREFERENCE")).toBe(false);
  });
});

describe("P5.4 Stage-2B — repair monotonicity audit", () => {
  it("destructive goal mutation is projected back and recorded", () => {
    const c = caseById("v4_f_08");
    const a1 = clone(c.golden); delete fnEntity(a1).label; // historical A1 shape
    const repair = clone(a1);
    repair.goals[0].inputs = [...repair.goals[0].inputs, `entity:${fnEntity(repair).id}`]; // the historical destructive edit
    const active = attemptCompileV5(a1, c.statement).errors;
    const audit = auditRepairV5(a1, repair, active);
    expect(audit.verdict).toBe("projected");
    expect(audit.protected_paths_restored).toEqual([`/goals/${repair.goals[0].goalId}/inputs`]);
    expect(audit.projected_candidate.goals[0].inputs).toEqual(a1.goals[0].inputs);
    expect(audit.model_repair_candidate.goals[0].inputs).toEqual(repair.goals[0].inputs); // raw candidate never mutated
    expect(audit.audit_notes.join(" ")).toMatch(/rejected/);
  });
  it("label-only repair passes the audit untouched (allowed)", () => {
    const c = caseById("v4_f_08");
    const a1 = clone(c.golden); delete fnEntity(a1).label;
    const repair = clone(a1); fnEntity(repair).label = fnEntity(c.golden).label;
    const active = attemptCompileV5(a1, c.statement).errors;
    const audit = auditRepairV5(a1, repair, active);
    expect(audit.verdict).toBe("allowed");
    expect(audit.protected_paths_restored).toEqual([]);
  });
});

describe("P5.4 Stage-2 pipeline — attemptCompileV5", () => {
  it("label-missing A1 reports the single precise identity error (derived cascade suppressed, count recorded)", () => {
    const c = caseById("v4_f_08");
    const a1 = clone(c.golden); delete fnEntity(a1).label;
    const att = attemptCompileV5(a1, c.statement);
    expect(att.ok).toBe(false);
    expect(att.errors.map((e) => e.code)).toEqual(["E_FUNCTION_DECLARATION_LABEL_MISSING"]);
    expect(att.suppressedFindings.count).toBeGreaterThan(0);
  });
  it("canonical label restores a clean accept (supported case)", () => {
    const c = caseById("v4_f_08");
    const att = attemptCompileV5(clone(c.golden), c.statement);
    expect(att.ok).toBe(true);
    expect(att.errors).toHaveLength(0);
  });
});

describe("P5.4 Stage-2D — grounding wrapper correctness debt fix", () => {
  it("wrapper is a faithful passthrough when the anchor verdict stands (no corrections)", () => {
    const c = caseById("v4_f_08");
    const spec = clone(c.golden);
    const base = groundProblemSpec(spec, c.statement);
    const v5 = groundProblemSpecV5(spec, c.statement);
    expect(v5.findings).toEqual(base.findings);
    expect((v5 as any).p54_stage2d_corrections ?? 0).toBe(0);
  });
});
