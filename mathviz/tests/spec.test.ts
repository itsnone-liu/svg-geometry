import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validatorFor, ROOT } from "../packages/contracts/src/load";
import { validateProblemSpec } from "../packages/contracts/src/spec-validate";
import { gateSchema, gateProvenance, gateCapability } from "../packages/contracts/src/gates";
import { canonicalSerialize } from "../packages/contracts/src/serialize";
import { compileProblemSpec } from "../packages/spec/src/compile";
import { extractPolynomial, rationalRoots } from "../packages/spec/src/poly";
import { compileFunction } from "../packages/domains/function2d/src/compile";
import { compileMotion } from "../packages/domains/motion1d/src/compile";
import { compileGeometry } from "../packages/domains/geometry2d/src/compile";
import { rat } from "../packages/runtime/src/expr/exact";

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    expect.fail(`expected error ${code}, but call succeeded`);
  } catch (e: any) {
    expect(e?.code ?? e?.name).toBe(code);
  }
}

const SPEC_DIR = path.join(ROOT, "fixtures", "spec");
const loadSpec = (f: string) => JSON.parse(fs.readFileSync(path.join(SPEC_DIR, f), "utf8"));

describe("P5.0 ProblemSpec v1 contract", () => {
  it("accepts the three handwritten domain specs (schema + semantics)", () => {
    for (const f of ["function2d-solve.spec.json", "motion1d-meeting.spec.json", "geometry2d-length.spec.json"]) {
      const doc = loadSpec(f);
      expect(validatorFor("problemspec")(doc), f).toBe(true);
      expect(validateProblemSpec(doc), f).toEqual([]);
    }
  });

  it("structurally cannot carry answers: goal extra fields and smuggled answer layers are schema-rejected", () => {
    const base = loadSpec("geometry2d-length.spec.json");
    const withAnswer = structuredClone(base);
    (withAnswer.goals[0] as any).value = { kind: "int", value: "10" };
    expect(validatorFor("problemspec")(withAnswer)).toBe(false);

    const smuggled = structuredClone(base);
    (smuggled as any).derived_facts = [{ fact_id: "ans", name: "answer", value: { kind: "int", value: "10" } }];
    expect(validatorFor("problemspec")(smuggled)).toBe(false);
    expect((smuggled as any).events).toBeUndefined();
  });

  it("rejects unknown, cross-domain, and non-goal capabilities plus dangling inputs and bad spans", () => {
    const base = loadSpec("geometry2d-length.spec.json");
    const g = (capabilityId: string, inputs: string[]) => ({ goalId: "g", capabilityId, inputs });
    const docOf = (goal: any) => ({ ...structuredClone(base), goals: [goal] });

    expect(validateProblemSpec(docOf(g("geometry2d.magic_wand", ["entity:AB"]))).map((e) => e.code)).toContain("E_CAPABILITY_UNSUPPORTED");
    expect(validateProblemSpec(docOf(g("function2d.solve_equation", ["entity:AB"]))).map((e) => e.code)).toContain("E_SCHEMA");
    expect(validateProblemSpec(docOf(g("geometry2d.equal_mark", ["entity:AB"]))).map((e) => e.code)).toContain("E_CAPABILITY_UNSUPPORTED");
    expect(validateProblemSpec(docOf(g("geometry2d.derive_length", ["entity:NOPE"]))).map((e) => e.code)).toContain("E_BINDING");

    const badSpan = structuredClone(base);
    badSpan.source_facts = [{
      fact_id: "given", name: "given", unit: "m", value: { kind: "int", value: "7" },
      provenance: { kind: "problem_text", span: { text: "长度是 7", start: 0, end: 5 } }
    }];
    expect(validateProblemSpec(badSpan).map((e) => e.code)).toContain("E_PROVENANCE");

    // duplicate inputs violate uniqueItems at the SCHEMA level
    expect(validatorFor("problemspec")(docOf(g("geometry2d.derive_length", ["entity:AB", "entity:AB"])))).toBe(false);
  });
});

describe("P5.0 deterministic spec compiler", () => {
  it("function2d: x^2-5x+6=0 compiles to exact facts {2,3} with derived provenance and verifies in the domain compiler", () => {
    const compiled = compileProblemSpec(loadSpec("function2d-solve.spec.json"));
    const values = compiled.math.derived_facts.map((f: any) => f.value).map((v: any) => Number(v.value));
    expect(values).toEqual([2, 3]);
    for (const f of compiled.math.derived_facts) {
      expect(f.provenance).toEqual({ kind: "derived", capability_id: "function2d.solve_equation", inputs: ["entity:eq_main"] });
    }
    expect(gateSchema(compiled.math, "math")).toEqual([]);
    expect(gateProvenance(compiled.math)).toEqual([]);
    expect(gateCapability(compiled.math)).toEqual([]);
    const program = compileFunction(compiled.math);
    expect(program.derivedClaims).toHaveLength(2); // compile-time exact verification passed
  });

  it("motion1d time origin is deterministic convention, not a fabricated source fact", () => {
    const doc = loadSpec("motion1d-meeting.spec.json");
    expect(doc.source_facts.some((f: any) => f.fact_id === "t0")).toBe(false);
    expect(doc.entities.every((e: any) => e.props.segments.every((s: any) => s.start === undefined))).toBe(true);
    const compiled = compileProblemSpec(doc);
    expect(compiled.goalResults[0]!.factIds).toContain("meet_time");
  });

  it("motion1d: meeting goal bootstraps the frozen motion solver; final IR re-verifies time and position facts", () => {
    const compiled = compileProblemSpec(loadSpec("motion1d-meeting.spec.json"));
    // solver output is passed through VERBATIM (exact rational form, q=1 kept)
    const byId = Object.fromEntries(compiled.math.derived_facts.map((f: any) => [f.fact_id, f.value]));
    expect(byId.meet_time).toEqual({ kind: "rational", p: "10", q: "1" });
    expect(byId.meet_pos).toEqual({ kind: "rational", p: "50", q: "1" });
    expect(compiled.math.events[0].at).toEqual({ kind: "rational", p: "10", q: "1" });
    const program = compileMotion(compiled.math); // re-verifies derived facts exactly
    expect(program.events[0]!.time).toEqual({ kind: "rational", p: "10", q: "1" });
  });

  it("geometry2d: |A(0,0)B(6,8)| = 10 exact, and the geometry adapter still compiles the document", () => {
    const compiled = compileProblemSpec(loadSpec("geometry2d-length.spec.json"));
    expect(compiled.math.derived_facts[0].value).toEqual({ kind: "int", value: "10" });
    expect(compiled.math.capabilities).toContain("geometry2d.derive_length");
    expect(compileGeometry(compiled.math).digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: two compiles are canonically byte-identical in all three domains", () => {
    for (const f of ["function2d-solve.spec.json", "motion1d-meeting.spec.json", "geometry2d-length.spec.json"]) {
      const a = compileProblemSpec(loadSpec(f));
      const b = compileProblemSpec(loadSpec(f));
      expect(canonicalSerialize(a.math)).toBe(canonicalSerialize(b.math));
    }
  });

  it("rational-root solver is fail-closed outside its certificate", () => {
    // x^2 - 2 = 0: real solutions exist but none are rational -> refuse
    expectCode(() => rationalRoots([rat(-2n), rat(0n), rat(1n)]), "E_CAPABILITY_UNSUPPORTED");
    // (x-2)(x^2+1) = x^3 - 2x^2 + x - 2: rational root 2 exists but the
    // irreducible residual may own real roots -> refuse (honesty > coverage)
    expectCode(() => rationalRoots([rat(-2n), rat(1n), rat(-2n), rat(1n)]), "E_CAPABILITY_UNSUPPORTED");
    // 0 = 0 identically -> refuse
    expectCode(() => rationalRoots([rat(0n)]), "E_CAPABILITY_UNSUPPORTED");
    // no real solutions at all: x^2 + 1 (residual stays degree 2) -> refuse:
    // the certificate cannot distinguish "no real roots" from "irrational roots"
    expectCode(() => rationalRoots([rat(1n), rat(0n), rat(1n)]), "E_CAPABILITY_UNSUPPORTED");
    // free parameter in the equation -> refused BEFORE solving (needs the
    // future ConditionalSolutionSet contract)
    const withParam = { t: "app", op: "+", args: [{ t: "sym", name: "x" }, { t: "sym", name: "a" }] };
    expectCode(() => extractPolynomial(withParam, "x"), "E_CAPABILITY_UNSUPPORTED");
    // rational coefficients and rational roots work: (3/2)x - 3 = 0 -> x = 2
    expect(rationalRoots([rat(-3n), rat(3n, 2n)]).map((r) => `${r.p}/${r.q}`)).toEqual(["2/1"]);
  });

  it("geometry solver refuses irrational DSL coordinates (v1 boundary)", () => {
    const spec = loadSpec("geometry2d-length.spec.json");
    spec.entities.find((e: any) => e.id === "B").props.x = "3*sqrt(2)";
    expectCode(() => compileProblemSpec(spec), "E_CAPABILITY_UNSUPPORTED");
  });

  it("goals that are not wired for the domain are refused loudly", () => {
    const spec = loadSpec("geometry2d-length.spec.json");
    spec.goals = [{ goalId: "g", capabilityId: "geometry2d.midpoint", inputs: ["entity:AB"] }];
    expectCode(() => compileProblemSpec(spec), "E_CAPABILITY_UNSUPPORTED");
  });
});

describe("P5.0.1 parser surface hardening", () => {
  const geo = () => loadSpec("geometry2d-length.spec.json");

  it("every source entity carries a valid problem_text span (fixtures re-signed)", () => {
    for (const f of ["function2d-solve.spec.json", "motion1d-meeting.spec.json", "geometry2d-length.spec.json"]) {
      const doc = loadSpec(f);
      for (const e of doc.entities) {
        const span = e.provenance?.span;
        expect(span, `${f}:${e.id}`).toBeTruthy();
        expect(doc.statement.slice(span.start, span.end)).toBe(span.text);
      }
      expect(validateProblemSpec(doc)).toEqual([]);
    }
  });

  it("schema rejects answer smuggled into props, unknown props, missing entity provenance, constraint params", () => {
    const withAnswer = geo();
    withAnswer.entities[0].props.answer = "10";
    expect(validatorFor("problemspec")(withAnswer)).toBe(false);

    const unknownProp = geo();
    unknownProp.entities[1].props.z = "9";
    expect(validatorFor("problemspec")(unknownProp)).toBe(false);

    const noProv = geo();
    delete noProv.entities[0].provenance;
    expect(validatorFor("problemspec")(noProv)).toBe(false);

    const withParams = geo();
    withParams.constraints = [{
      capability_id: "geometry2d.collinear",
      subject_refs: ["entity:A", "entity:B"],
      provenance: structuredClone(geo().entities[0].provenance),
      params: { x: 1 }
    }];
    expect(validatorFor("problemspec")(withParams)).toBe(false);
  });

  it("validator flags duplicate ids, dangling internal refs, bad spans, wrong-kind endpoints", () => {
    const dup = geo();
    dup.entities.push(structuredClone(dup.entities[1]));
    expect(validateProblemSpec(dup).map((e) => e.code)).toContain("E_SCHEMA");

    const dangling = geo();
    dangling.entities[2].props.a = "Z";
    expect(validateProblemSpec(dangling).map((e) => e.code)).toContain("E_BINDING");

    const wrongKind = geo();
    wrongKind.entities[2].props.a = "AB";
    expect(validateProblemSpec(wrongKind).map((e) => e.code)).toContain("E_BINDING");

    const badSpan = geo();
    badSpan.entities[0].provenance = { kind: "problem_text", span: { text: "点 P(9, 9)", start: 0, end: 8 } };
    expect(validateProblemSpec(badSpan).map((e) => e.code)).toContain("E_PROVENANCE");

    const crossKind = geo();
    crossKind.entities.push({ id: "bod", kind: "body", props: { capability_id: "motion1d.constant_velocity", initial_position: "math:fact:x", segments: [] }, provenance: structuredClone(geo().entities[0].provenance) });
    expect(validateProblemSpec(crossKind).map((e) => e.code)).toContain("E_SCHEMA");
  });

  it("expression symbol closure: undeclared symbols fail, declared parameters pass", () => {
    const fx = loadSpec("function2d-solve.spec.json");
    const withK = structuredClone(fx);
    withK.entities[0].props.lhs = {
      t: "app", op: "+",
      args: [withK.entities[0].props.lhs, { t: "sym", name: "mysterious_k" }]
    };
    expect(validateProblemSpec(withK).map((e) => e.code)).toContain("E_BINDING");

    const declared = structuredClone(fx);
    declared.parameters = [{ id: "k", min: { kind: "int", value: "0" }, max: { kind: "int", value: "9" } }];
    declared.entities[0].props.lhs = {
      t: "app", op: "+",
      args: [declared.entities[0].props.lhs, { t: "sym", name: "k" }]
    };
    const errs = validateProblemSpec(declared);
    expect(errs.filter((e) => e.code === "E_BINDING")).toEqual([]); // symbol closed
  });

  it("compiler surface is enforced: registry existence alone does not make a goal emittable", () => {
    const spec = geo();
    spec.goals = [{ goalId: "g", capabilityId: "geometry2d.midpoint", inputs: ["entity:AB"] }];
    const errs = validateProblemSpec(spec);
    expect(errs.map((e) => e.code)).toContain("E_CAPABILITY_UNSUPPORTED");
    expect(errs.some((e) => e.message.includes("Compiler Capability Surface"))).toBe(true);
  });

  it("compiled Math IR no longer carries spec-layer provenance on entities", () => {
    const compiled = compileProblemSpec(loadSpec("geometry2d-length.spec.json"));
    for (const e of compiled.math.entities) {
      expect(e.provenance).toBeUndefined();
    }
  });
});
