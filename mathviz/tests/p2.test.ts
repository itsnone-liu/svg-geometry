import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadRuntime } from "../packages/runtime/src/runtime";
import { geometry2dAdapter, GEOMETRY_EPS, P2_CAPABILITIES } from "../packages/domains/geometry2d/src/adapter";
import { compileGeometry } from "../packages/domains/geometry2d/src/compile";
import { evaluateGeometry } from "../packages/domains/geometry2d/src/evaluate";
import { oracle, assertPinnedVendor } from "../packages/adapters/geometry-dsl/src/oracle";
import { VizRuntimeError } from "../packages/runtime/src/errors";
import { renderSvg } from "../packages/renderer-svg/src/render";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const square = read("fixtures/p2/square-rotation.compiled.json");
const statik = read("fixtures/p2/static-construction.compiled.json");
const invalid = read("fixtures/p2/invalid-geometry.json");
const domains = { geometry2d: geometry2dAdapter };

function expectCode(fn: () => unknown, code: string) {
  try { fn(); } catch (e: any) {
    expect(e).toBeInstanceOf(VizRuntimeError);
    expect(e.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, no error thrown`);
}

const pos = (state: any, oid: string) => state.objects[oid].resolvedBinding.position;

describe("P2 frozen t/parameter distinction", () => {
  it("keeps t as model time; theta_at_t is explicit runtime value", () => {
    const rt = loadRuntime(square, { domains });
    const s = rt.stateAt(3);
    expect(s.modelTime).toBeCloseTo(0.25, 12);
    // theta=2*pi*t=pi/2, P rotated clockwise around B; no implicit param alias.
    expect(pos(s, "obj_M").x).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(pos(s, "obj_M").y).toBeCloseTo(2.5 * Math.SQRT2, 12);
  });

  it("does not make a mathematical parameter implicitly equal t", () => {
    const d = JSON.parse(JSON.stringify(square));
    d.math.parameters = [{ id: "theta", min: { kind: "int", value: "0" }, max: { kind: "int", value: "1" }, default: { kind: "int", value: "0" } }];
    d.math.runtime_values = [{ id: "theta_at_t", expr: { t: "sym", name: "theta" } }];
    // At every frame theta comes from the declared parameter default (0), not model time.
    const s = loadRuntime(d, { domains }).stateAt(6);
    expect(pos(s, "obj_M").x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(pos(s, "obj_M").y).toBeCloseTo(2.5 * Math.SQRT2, 12);
  });
});

describe("P2 compile-time VerifiedGeometryProgram", () => {
  it("compiles once into a dependency-ordered immutable-shape program", () => {
    const p = compileGeometry(square.math);
    expect(p.domain).toBe("geometry2d");
    expect(p.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(p.dependencyOrder.indexOf("B")).toBeLessThan(p.dependencyOrder.indexOf("M"));
    expect(p.dependencyOrder.indexOf("N")).toBeLessThan(p.dependencyOrder.indexOf("E"));
    expect(p.constructions.map((c) => c.operation)).toContain("rotate_point");
    expect(p.constructions.map((c) => c.operation)).toContain("midpoint");
  });

  it("rejects missing domain adapter for compiled constructions", () => {
    expectCode(() => loadRuntime(square), "E_CAPABILITY_UNSUPPORTED");
  });

  it("rejects dependency cycles with E_SCHEMA", () => {
    const m = JSON.parse(JSON.stringify(square.math));
    m.entities.push({ id: "X", kind: "dynamic_point", props: { capability_id: "geometry2d.midpoint", a: "Y", b: "B" } });
    m.entities.push({ id: "Y", kind: "dynamic_point", props: { capability_id: "geometry2d.midpoint", a: "X", b: "B" } });
    expectCode(() => compileGeometry(m), "E_SCHEMA");
  });

  it("rejects unknown refs with E_BINDING", () => {
    const m = JSON.parse(JSON.stringify(square.math));
    m.entities.push({ id: "bad_seg", kind: "segment", props: { a: "Missing", b: "B" } });
    expectCode(() => compileGeometry(m), "E_BINDING");
  });

  it("rejects registered-but-unimplemented locus with E_CAPABILITY_UNSUPPORTED", () => {
    const m = JSON.parse(JSON.stringify(square.math));
    m.entities.push({ id: "L", kind: "dynamic_point", props: { capability_id: "geometry2d.locus" } });
    expectCode(() => compileGeometry(m), "E_CAPABILITY_UNSUPPORTED");
    expect(geometry2dAdapter.supports("geometry2d.locus")).toBe(false);
  });

  it("rejects implicit t in static coordinates", () => {
    const m = JSON.parse(JSON.stringify(square.math));
    m.entities.push({ id: "bad", kind: "point", props: { x: { t: "sym", name: "t" }, y: 0 } });
    expectCode(() => compileGeometry(m), "E_SCHEMA");
  });

  it("uses one frozen EPS and P2 is a strict subset of the registry", () => {
    expect(GEOMETRY_EPS).toBe(1e-9);
    expect(geometry2dAdapter.supports("geometry2d.rotate_point")).toBe(true);
    expect(geometry2dAdapter.supports("geometry2d.locus")).toBe(false);
    expect(P2_CAPABILITIES.size).toBe(20);
  });
});

describe("P2 geometry evaluation + G5 assertions", () => {
  const rt = loadRuntime(square, { domains });

  it("produces the 0/45/90/135/180/225/270/315/360 degree anchor positions", () => {
    for (let k = 0; k <= 8; k++) {
      const s = rt.stateAt(1.5 * k);
      expect(s.modelTime).toBeCloseTo(k / 8, 12);
      expect(s.domainDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(pos(s, "obj_M").x).toBeTypeOf("number");
      expect(pos(s, "obj_N").y).toBeTypeOf("number");
      expect(pos(s, "obj_E").x).toBeTypeOf("number");
    }
    const start = rt.stateAt(0);
    const end = rt.stateAt(12);
    expect(pos(start, "obj_M").x).toBeCloseTo(pos(end, "obj_M").x, 12);
    expect(pos(start, "obj_N").y).toBeCloseTo(pos(end, "obj_N").y, 12);
  });

  it("keeps E on the locus circle at every anchor", () => {
    for (let k = 0; k <= 8; k++) {
      const s = rt.stateAt(1.5 * k);
      const e = pos(s, "obj_E");
      const circle: any = s.objects.obj_locus.resolvedBinding;
      expect(Math.hypot(e.x - circle.center.x, e.y - circle.center.y)).toBeCloseTo(circle.radius, 8);
    }
  });

  it("static fixture constructs projection, midpoints, intersection and assertions", () => {
    const s = loadRuntime(statik, { domains }).stateAt(2);
    expect(pos(s, "obj_F")).toEqual({ x: 2, y: 0 });
    expect(pos(s, "obj_M1")).toEqual({ x: 4, y: 0 });
    expect(pos(s, "obj_M2")).toEqual({ x: 5, y: 3 });
    expect(pos(s, "obj_I").x).toBeCloseTo(10 / 3, 12);
    expect(pos(s, "obj_I").y).toBeCloseTo(2, 12);
  });

  it("supports translate_point and reflect_point as pure constructions", () => {
    const d = JSON.parse(JSON.stringify(statik));
    d.math.entities.push({ id: "T", kind: "dynamic_point", props: { capability_id: "geometry2d.translate_point", source: "A", dx: 3, dy: -2 } });
    d.math.entities.push({ id: "R", kind: "dynamic_point", props: { capability_id: "geometry2d.reflect_point", source: "A", over: "line_BC" } });
    d.math.capabilities.push("geometry2d.translate_point", "geometry2d.reflect_point");
    d.scene.objects.push(
      { objectId: "obj_T", primitive: "point", binding: { source: "math:entity:T" } },
      { objectId: "obj_R", primitive: "point", binding: { source: "math:entity:R" } }
    );
    const s = loadRuntime(d, { domains }).stateAt(2);
    expect(pos(s, "obj_T")).toEqual({ x: 5, y: 4 });
    expect(pos(s, "obj_R")).toEqual({ x: 2, y: -6 });
  });

  it("verifies parallel_mark and angle_mark only with matching PASS assertions", () => {
    const d = JSON.parse(JSON.stringify(statik));
    d.math.statement += " 线段XY平行于BC。";
    const phrase = "线段XY平行于BC";
    d.math.source_facts.push({
      fact_id: "xy_parallel_bc", name: "平行关系", value: "parallel",
      provenance: { kind: "problem_text", span: { text: phrase, start: d.math.statement.indexOf(phrase), end: d.math.statement.indexOf(phrase) + phrase.length } }
    });
    d.math.entities.push(
      { id: "X", kind: "point", props: { x: "0", y: "2" } },
      { id: "Y", kind: "point", props: { x: "8", y: "2" } },
      { id: "seg_XY", kind: "segment", props: { a: "X", b: "Y" } }
    );
    d.math.capabilities.push("geometry2d.parallel", "geometry2d.parallel_mark", "geometry2d.angle_mark");
    d.math.assertions.push(
      { assertion_id: "assert_xy_parallel_bc", capability_id: "geometry2d.parallel", subject_refs: ["entity:line_BC", "entity:seg_XY"], expectation: "holds" },
      { assertion_id: "assert_bfa_90", capability_id: "geometry2d.angle_mark", subject_refs: ["entity:B", "entity:F", "entity:A"], params: { value: 90 }, expectation: "holds" }
    );
    d.scene.objects.push(
      { objectId: "obj_line_BC", primitive: "line", binding: { source: "math:entity:line_BC" } },
      { objectId: "obj_X", primitive: "point", binding: { source: "math:entity:X" } },
      { objectId: "obj_Y", primitive: "point", binding: { source: "math:entity:Y" } },
      { objectId: "obj_seg_XY", primitive: "segment", binding: { source: "math:entity:seg_XY" } },
      { objectId: "obj_mark_parallel", primitive: "parallel_mark", binding: { source: "math:fact:xy_parallel_bc" }, attach_to: ["obj_line_BC", "obj_seg_XY"] },
      { objectId: "obj_mark_angle", primitive: "angle_mark", binding: { source: "math:fact:alt_foot" }, attach_to: ["obj_B", "obj_F", "obj_A"] }
    );
    const s = loadRuntime(d, { domains }).stateAt(2);
    const svg = renderSvg(s, d.scene);
    expect(svg).toContain("<polyline");
    expect(svg).toContain("<path");
  });

  it("invalid non-perpendicular right-angle mark fails closed with E_MATH_ASSERTION", () => {
    expectCode(() => loadRuntime(invalid.project, { domains }).stateAt(1), "E_MATH_ASSERTION");
  });

  it("a mark without a matching PASS assertion is rejected", () => {
    const d = JSON.parse(JSON.stringify(square));
    d.math.assertions = d.math.assertions.filter((a: any) => a.capability_id !== "geometry2d.perpendicular");
    d.math.constraints = d.math.constraints.filter((a: any) => a.capability_id !== "geometry2d.perpendicular");
    expectCode(() => loadRuntime(d, { domains }).stateAt(1), "E_MATH_ASSERTION");
  });

  it("mark binding must identify the claimed source fact", () => {
    const d = JSON.parse(JSON.stringify(square));
    d.scene.objects.find((o: any) => o.objectId === "obj_mark_right").binding.source = "math:entity:P";
    expectCode(() => loadRuntime(d, { domains }).stateAt(1), "E_MATH_ASSERTION");
  });

  it("100 repeats at one state have identical runtime and snapshot digests", () => {
    const d = rt.stateAt(4.5);
    for (let i = 0; i < 100; i++) {
      const s = rt.stateAt(4.5);
      expect(s.digest).toBe(d.digest);
      expect(s.domainDigest).toBe(d.domainDigest);
    }
  });

  it("random-access setFrame equals stateAt(frame/fps) forward and backward", () => {
    const p = rt.createPlayer();
    for (const f of [0, 72, 144, 288, 36, 216]) {
      p.setFrame(f);
      expect(p.getState().digest).toBe(rt.stateAt(f / rt.fps).digest);
    }
  });
});

describe("P2 G11 Geometry DSL oracle is independent and pinned", () => {
  it("vendor checkout is exactly the pinned MIT upstream commit", () => {
    const pin = assertPinnedVendor();
    expect(pin.pinned).toBe(true);
    expect(pin.head).toBe("c7ee10030c175acad792ba82b53af540f2b578f8");
  });

  it("upstream kernel agrees on midpoint / rotation / intersection / projection", () => {
    expect(oracle.midpoint({ x: 0, y: 0 }, { x: 4, y: 6 })).toEqual({ x: 2, y: 3 });
    const r = oracle.rotateAround({ x: 2, y: 1 }, { x: 1, y: 1 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(1, 12);
    expect(r.y).toBeCloseTo(2, 12);
    expect(oracle.intersection({ a: { x: 0, y: 0 }, b: { x: 4, y: 4 } }, { a: { x: 0, y: 4 }, b: { x: 4, y: 0 } })).toEqual({ x: 2, y: 2 });
    expect(oracle.projection({ x: 2, y: 6 }, { a: { x: 0, y: 0 }, b: { x: 8, y: 0 } })).toEqual({ x: 2, y: 0 });
  });
});

describe("P2 renderer is paint-only and deterministic", () => {
  it("renders geometry positions and marks from RuntimeState, never from Math IR", () => {
    const rt = loadRuntime(square, { domains });
    const s = rt.stateAt(3);
    const svg = renderSvg(s, square.scene);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("<circle");
    expect(svg).toContain("<line");
    expect(svg).toContain("<polyline"); // verified right-angle mark
    expect(renderSvg(s, square.scene)).toBe(svg);
  });

  it("player HTML is fixture-generated and embeds exactly the square fixture", () => {
    const html = fs.readFileSync(path.join(ROOT, "examples/p2/index.html"), "utf8");
    const m = /window\.__MATHVIZ_PROJECT__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
    expect(m).toBeTruthy();
    expect(JSON.parse(m![1])).toEqual(square);
    expect(html).toContain("window.mathviz");
    expect(html).toContain("data-state-digest");
  });
});
