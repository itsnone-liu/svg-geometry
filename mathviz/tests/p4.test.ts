import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadRuntime } from "../packages/runtime/src/runtime";
import { summarizeGates } from "../packages/runtime/src/gate-summary";
import { function2dAdapter } from "../packages/domains/function2d/src/adapter";
import { compileFunction } from "../packages/domains/function2d/src/compile";
import { evaluateFunction } from "../packages/domains/function2d/src/evaluate";
import { differentiate } from "../packages/domains/function2d/src/differentiate";
import { sampleFunction } from "../packages/domains/function2d/src/sampling";
import { checkCartesianWindow } from "../packages/domains/function2d/src/layout";
import { FUNCTION2D_CAPABILITIES, FUNCTION_EPS, FUNCTION_SAMPLE_COUNT } from "../packages/domains/function2d/src/constants";
import { resolveSource } from "../packages/runtime/src/bindings/resolve";
import { renderSvg } from "../packages/renderer-svg/src/render";
import { VizRuntimeError } from "../packages/runtime/src/errors";
import { runCase } from "../packages/contracts/src/gates";
import type { CompiledFunction } from "../packages/domains/function2d/src/types";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const fixtures: Record<string, any> = {
  sweep: read("fixtures/p4/quadratic-sweep.compiled.json"),
  intersections: read("fixtures/p4/intersections.compiled.json"),
  calculus: read("fixtures/p4/derivative-extrema.compiled.json"),
  equation: read("fixtures/p4/equation.compiled.json"),
  invalid: read("fixtures/p4/invalid-function.compiled.json")
};
const domains = { function2d: function2dAdapter };
function expectCode(fn: () => unknown, code: string) {
  try { fn(); } catch (e: any) {
    expect(e).toBeInstanceOf(VizRuntimeError);
    expect(e.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, no error thrown`);
}

describe("P4 Function2D Math IR -> VerifiedFunctionProgram", () => {
  it("implements all eight registered function2d capabilities", () => {
    expect(FUNCTION2D_CAPABILITIES.size).toBe(8);
    for (const id of [
      "function2d.expression_curve", "function2d.roots", "function2d.intersection",
      "function2d.derivative_at", "function2d.extremum", "function2d.parameter_sweep",
      "function2d.value_at", "function2d.solve_equation"
    ]) {
      expect(function2dAdapter.supports(id)).toBe(true);
    }
  });

  it("contract-validates the four positive projects and oracle-negative project", () => {
    for (const [name, doc] of Object.entries(fixtures)) {
      const result = runCase({ case_id: `p4-${name}`, kind: "project", expect: "pass", doc });
      expect(result.ok, `${name}: ${JSON.stringify(result.emitted_error_codes)}`).toBe(true);
    }
  });

  it("uses a declared default parameter when no runtime binding is present", () => {
    const doc = structuredClone(fixtures.sweep);
    doc.math.entities.find((e: any) => e.id === "f").props.parameter_bindings = {};
    doc.math.capabilities = doc.math.capabilities.filter((c: string) => c !== "function2d.parameter_sweep");
    const rt = loadRuntime(doc, { domains });
    const state = rt.stateAt(6);
    const curve: any = state.objects.curve_f.resolvedBinding;
    expect(curve.parameterValues.a).toBe(0); // declared default, not model time t=0.5
    expect(state.objects.pt_root_left.resolvedBinding).toEqual({ x: -1, y: 0 });
    expect(state.objects.pt_root_right.resolvedBinding).toEqual({ x: 1, y: 0 });
  });

  it("moves curve, roots, and vertex from runtime parameter binding at arbitrary time", () => {
    const program = compileFunction(fixtures.sweep.math);
    expect(program.samplingPolicy).toEqual({ sampleCount: FUNCTION_SAMPLE_COUNT, eps: FUNCTION_EPS });
    expect(program.functions[0].parameterBindings.a).toBe("math:runtime:a_at_t");
    const rt = loadRuntime(fixtures.sweep, { domains });
    const s = rt.stateAt(6); // model time 0.5 -> a = 0
    expect(s.modelTime).toBeCloseTo(0.5, 12);
    const curve: any = s.objects.curve_f.resolvedBinding;
    expect(curve.kind).toBe("function_curve");
    expect(curve.parameterValues.a).toBeCloseTo(0, 12);
    expect(curve.segments).toHaveLength(1);
    expect(curve.segments[0]).toHaveLength(257);
    // Scene point objects bind math:fact:<id>.point -> snapshot fact projection
    expect(s.objects.pt_root_left.resolvedBinding).toEqual({ x: -1, y: 0 });
    expect(s.objects.pt_root_right.resolvedBinding).toEqual({ x: 1, y: 0 });
    expect(s.objects.pt_vertex.resolvedBinding).toEqual({ x: 0, y: -1 });
    expect(s.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(rt.stateAt(6).digest).toBe(s.digest);
  });

  it("evaluates intersections, derivatives, extrema, values, and exact equation roots", () => {
    const intersections = loadRuntime(fixtures.intersections, { domains }).stateAt(3);
    expect(intersections.objects.pt_x_left.resolvedBinding).toEqual({ x: -1, y: 1 });
    expect(intersections.objects.pt_x_right.resolvedBinding).toEqual({ x: 3, y: 9 });

    const calc = loadRuntime(fixtures.calculus, { domains }).stateAt(3);
    expect(calc.objects.pt_max.resolvedBinding).toEqual({ x: -1, y: 2 });
    expect(calc.objects.pt_min.resolvedBinding).toEqual({ x: 1, y: -2 });
    expect(calc.objects.pt_d2.resolvedBinding).toEqual({ x: 2, y: 9 });
    expect(calc.objects.pt_v2.resolvedBinding).toEqual({ x: 2, y: 2 });

    const eq = loadRuntime(fixtures.equation, { domains }).stateAt(3);
    expect(eq.objects.pt_sol_left.resolvedBinding).toEqual({ x: 2, y: 0 });
    expect(eq.objects.pt_sol_right.resolvedBinding).toEqual({ x: 3, y: 0 });
  });

  it("validates each Function2D scene's fixed cartesian window", () => {
    for (const doc of Object.values(fixtures)) {
      expect(checkCartesianWindow((doc as any).scene).xMax).toBeGreaterThan(checkCartesianWindow((doc as any).scene).xMin);
    }
    const scene = structuredClone(fixtures.sweep.scene);
    scene.layoutRules = [];
    expectCode(() => checkCartesianWindow(scene), "E_LAYOUT");
    scene.layoutRules = [fixtures.sweep.scene.layoutRules[0], fixtures.sweep.scene.layoutRules[0]];
    expectCode(() => checkCartesianWindow(scene), "E_LAYOUT");
    scene.layoutRules = [{ kind: "cartesian_window", x_min: 1, x_max: 0, y_min: -1, y_max: 1 }];
    expectCode(() => checkCartesianWindow(scene), "E_LAYOUT");
  });

  it("symbolically differentiates frozen powers and rejects variable exponents", () => {
    const cube = { t: "app", op: "^", args: [{ t: "sym", name: "x" }, { t: "num", v: { kind: "int", value: "3" } }] };
    const d = differentiate(cube, "x");
    expect(d).toMatchObject({ t: "app", op: "*" });
    const variablePower = { t: "app", op: "^", args: [{ t: "sym", name: "x" }, { t: "sym", name: "x" }] };
    expectCode(() => differentiate(variablePower, "x"), "E_CAPABILITY_UNSUPPORTED");
  });

  it("splits deterministic sampling at an expression-domain failure", () => {
    const fn: CompiledFunction = {
      id: "reciprocal", variable: "x",
      expr: { t: "app", op: "/", args: [{ t: "num", v: { kind: "int", value: "1" } }, { t: "sym", name: "x" }] },
      xMin: { kind: "rational", p: "-1", q: "1" },
      xMax: { kind: "rational", p: "1", q: "1" },
      parameterBindings: {}
    };
    const sampled = sampleFunction(fn, {}, 3);
    expect(sampled.breakCount).toBe(1);
    expect(sampled.segments).toHaveLength(2);
    expect(sampled.segments.map((s) => s[0].x)).toEqual([-1, 1]);
  });

  it("renders sampled curve/axes using the fixed window, not data autofit", () => {
    const s = loadRuntime(fixtures.sweep, { domains }).stateAt(6);
    const svg = renderSvg(s, fixtures.sweep.scene);
    expect(svg).toContain('data-window="[-5,-2]-[5,12]"');
    expect(svg).toContain("<polyline");
    expect(svg).toContain("<line");
    expect(svg).not.toContain("data-world=");
  });

  it("allows a candidate solution locally while the independent oracle rejects non-finite completeness", () => {
    // Browser/TS can prove tan(0)=0, but cannot certify that this is the
    // complete real solution set. G13 rejects this fixture as ImageSet.
    const program = compileFunction(fixtures.invalid.math);
    expect(program.derivedClaims).toHaveLength(1);
    const state = loadRuntime(fixtures.invalid, { domains }).stateAt(3);
    expect(state.objects.pt_sol_zero.resolvedBinding).toEqual({ x: 0, y: 0 });
  });

  it("P4.1: fact projection replaces drawable entities in Math IR", () => {
    // No fixture entity is drawing-motivated anymore...
    for (const doc of Object.values(fixtures)) {
      expect((doc.math.entities as any[]).some((e) => e.kind === "claim_point")).toBe(false);
    }
    // ...and re-adding one fails closed at compile time.
    const doc = structuredClone(fixtures.equation);
    doc.math.entities.push({ id: "pt_back", kind: "claim_point", props: { fact_id: "sol_left" } });
    expectCode(() => compileFunction(doc.math), "E_CAPABILITY_UNSUPPORTED");

    // Snapshot exposes facts keyed by fact id (point + numeric value) and the
    // digest covers them; scene objects resolve math:fact:<id>.point directly.
    const rt = loadRuntime(fixtures.sweep, { domains });
    const s6 = rt.stateAt(6); // a = 0
    const snap = (s6 as any).domainDigest;
    expect(snap).toMatch(/^[0-9a-f]{64}$/);
    const prog = compileFunction(fixtures.sweep.math);
    const snapshot6 = evaluateFunction(prog, { modelTime: 0.5, env: { t: { kind: "num", v: 0.5 } }, resolveBinding: (src: string) => (src === "math:runtime:a_at_t" ? 0 : null) } as any);
    expect(snapshot6.facts.root_left).toEqual({ kind: "roots", value: -1, point: { x: -1, y: 0 } });
    expect(snapshot6.facts.vertex_x).toEqual({ kind: "extremum", value: 0, point: { x: 0, y: -1 } });
    expect(Object.values(snapshot6.entities).every((e: any) => e.kind === "function_curve")).toBe(true);

    // Outside every mapping window the claim is INACTIVE: fact exists, values null.
    const s0 = rt.stateAt(0);
    expect(s0.objects.pt_root_left.resolvedBinding).toBeNull();

    // Resolver order: snapshot fact first, frozen Math fact fallback when no
    // snapshot carries the fact (labels may bind the frozen ExactNumber).
    const math = fixtures.equation.math;
    const frozen = resolveSource(math, "math:fact:sol_left.value", {});
    expect(frozen).toEqual({ kind: "int", value: "2" }); // frozen fallback, no snapshot
    expectCode(() => resolveSource(math, "math:fact:no_such_fact.value", {}), "E_BINDING");
  });

  it("keeps SymPy freeze-required: explicit skip is incomplete, never green", () => {
    const gates = [
      { gate: "G13_function_sympy_oracle", status: "SKIP" },
      { gate: "G10_cross_output_consistency", status: "PASS" },
      { gate: "G14_function_invariants", status: "PASS" }
    ];
    expect(summarizeGates(gates, false).summary).toBe("FAILURES PRESENT");
    expect(summarizeGates([{ gate: "some-gate", status: "PASS" }], false).summary).toBe("FAILURES PRESENT");
    expect(summarizeGates(gates, false, { allowSympySkip: true })).toEqual({ summary: "INCOMPLETE", exitCode: 0 });
    expect(summarizeGates([{ ...gates[0], status: "INCOMPLETE" }, ...gates.slice(1)], false, { allowSympySkip: true })).toEqual({ summary: "INCOMPLETE", exitCode: 1 });
    expect(summarizeGates(gates.map((g) => ({ ...g, status: "PASS" })), false).summary).toBe("ALL GREEN");
  });
});
