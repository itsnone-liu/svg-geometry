import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadRuntime } from "../packages/runtime/src/runtime";
import { motion1dAdapter } from "../packages/domains/motion1d/src/adapter";
import { compileMotion } from "../packages/domains/motion1d/src/compile";
import { evaluateMotion } from "../packages/domains/motion1d/src/evaluate";
import { normalize } from "../packages/domains/motion1d/src/units";
import { fromJson, toExact } from "../packages/domains/motion1d/src/exact";
import { renderSvg } from "../packages/renderer-svg/src/render";
import { VizRuntimeError } from "../packages/runtime/src/errors";
import { checkMotionInvariants } from "../packages/domains/motion1d/src/invariants";
import { runCase } from "../packages/contracts/src/gates";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const pursuit = read("fixtures/p3/pursuit.compiled.json");
const meeting = read("fixtures/p3/meeting.compiled.json");
const piecewise = read("fixtures/p3/piecewise.compiled.json");
const invalidPiecewise = read("fixtures/p3/invalid-piecewise-teleport.compiled.json");
const catchStopped = read("fixtures/p3/catch-stopped.compiled.json");
const domains = { motion1d: motion1dAdapter };
function expectCode(fn: () => unknown, code: string) {
  try { fn(); } catch (e: any) {
    expect(e).toBeInstanceOf(VizRuntimeError);
    expect(e.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, no error thrown`);
}
const fraction = (v: any) => `${v.p}/${v.q}`;

describe("P3 Motion1D exact Math IR -> VerifiedMotionProgram", () => {
  it("implements all seven registered motion capabilities", () => {
    for (const id of [
      "motion1d.constant_velocity", "motion1d.piecewise_constant_velocity",
      "motion1d.meeting_event", "motion1d.overtake_event", "motion1d.reach_event",
      "motion1d.unit_normalize", "motion1d.solve_position"
    ]) expect(motion1dAdapter.supports(id)).toBe(true);
  });

  it("normalizes 1 km/h to exact 5/18 m/s", () => {
    expect(fraction(toExact(normalize(fromJson({ kind: "int", value: "1" }, "test"), "km/h", "velocity", "test")))).toBe("5/18");
  });

  it("solves pursuit exactly and verifies frozen derived time/position", () => {
    const p = compileMotion(pursuit.math);
    expect(p.events).toHaveLength(1);
    expect(fraction(p.events[0].time)).toBe("80/3");
    expect(fraction(p.events[0].position)).toBe("400/3");
    expect(p.bodies.find((b) => b.id === "B")!.segments[0].velocity).toMatchObject({ p: "8", q: "1" });
  });

  it("solves head-on meeting exactly at 10s, 50m", () => {
    const p = compileMotion(meeting.math);
    expect(fraction(p.events[0].time)).toBe("10/1");
    expect(fraction(p.events[0].position)).toBe("50/1");
  });

  it("compiles continuous piecewise movement, stationary final interval, and reach event", () => {
    const p = compileMotion(piecewise.math);
    expect(fraction(p.events[0].time)).toBe("20/1");
    expect(fraction(p.events[0].position)).toBe("130/1");
  });

  it("catches a stopped body via the effective event domain (synthetic tail, solver-only)", () => {
    const p = compileMotion(catchStopped.math);
    expect(fraction(p.events[0].time)).toBe("15/1");
    expect(fraction(p.events[0].position)).toBe("50/1");
    // The synthetic stationary tail must never be written back into the frozen program.
    expect(p.bodies.find((b: any) => b.id === "A")!.segments).toHaveLength(1);
    expect(p.bodies.find((b: any) => b.id === "A")!.segments[0].end).toMatchObject({ p: "10", q: "1" });
    expect(p.bodies.find((b: any) => b.id === "A")!.segments[0].velocity).toMatchObject({ p: "5", q: "1" });
  });

  it("rejects overtake when the first participant never passes the second", () => {
    const swapped = structuredClone(catchStopped.math);
    swapped.events[0].participants = ["entity:A", "entity:B"];
    swapped.derived_facts.find((f: any) => f.fact_id === "catch_time").provenance.inputs = ["entity:A", "entity:B"];
    swapped.events[0].at = undefined;
    swapped.derived_facts = swapped.derived_facts.filter((f: any) => f.fact_id !== "catch_time");
    expectCode(() => compileMotion(swapped), "E_MATH_CONSTRAINT");
  });

  it("G12 proves overtake reversal and event equality with exact rationals", () => {
    const stopped = compileMotion(catchStopped.math);
    const checks = checkMotionInvariants(stopped, [0, 5, 10, 15, 20]);
    const reversal = checks.find((c: any) => c.name === "overtake-reversal:catch");
    expect(reversal?.pass).toBe(true);
    expect(reversal?.detail).toContain("-25/1 < 0 = 0/1 < 10/1");
    const exact = checks.find((c: any) => c.name === "event-equality-exact:catch");
    expect(exact?.pass).toBe(true);
    const pursuitChecks = checkMotionInvariants(compileMotion(pursuit.math), [80 / 3]);
    expect(pursuitChecks.find((c: any) => c.name === "overtake-reversal:overtake")?.pass).toBe(true);
    expect(pursuitChecks.find((c: any) => c.name === "event-equality-exact:overtake")?.pass).toBe(true);
  });

  it("validates the compiled invalid fixture through generic contracts and adapter", () => {
    const result = runCase({ case_id: "p3-invalid-teleport", kind: "project", expect: "pass", doc: invalidPiecewise });
    expect(result.ok).toBe(true); // Contract layer remains structurally valid.
    expectCode(() => compileMotion(invalidPiecewise.math), "E_MATH_CONSTRAINT");
  });

  it("rejects incorrect frozen event time and position as E_MATH_ASSERTION", () => {
    const wrongTime = structuredClone(pursuit.math);
    wrongTime.events[0].at = undefined;
    wrongTime.derived_facts.find((f: any) => f.fact_id === "catch_time").value = { kind: "rational", p: "27", q: "1" };
    expectCode(() => compileMotion(wrongTime), "E_MATH_ASSERTION");
    const wrongPosition = structuredClone(pursuit.math);
    wrongPosition.derived_facts.find((f: any) => f.fact_id === "catch_position").value = { kind: "int", value: "133" };
    expectCode(() => compileMotion(wrongPosition), "E_MATH_ASSERTION");
  });

  it("rejects teleport/gap, overlap, and no-order-reversal overtake", () => {
    const gap = structuredClone(piecewise.math);
    gap.source_facts.push({ ...structuredClone(gap.source_facts.find((f: any) => f.fact_id === "t10")), fact_id: "t10_end" });
    gap.entities[0].props.segments[0].end = "math:fact:t10_end";
    gap.source_facts.find((f: any) => f.fact_id === "t10").value = { kind: "int", value: "11" };
    expectCode(() => compileMotion(gap), "E_MATH_CONSTRAINT");
    const overlap = structuredClone(piecewise.math);
    overlap.source_facts.push({ ...structuredClone(overlap.source_facts.find((f: any) => f.fact_id === "t10")), fact_id: "t10_late" });
    overlap.source_facts.find((f: any) => f.fact_id === "t10_late").value = { kind: "int", value: "9" };
    overlap.entities[0].props.segments[1].start = "math:fact:t10_late";
    expectCode(() => compileMotion(overlap), "E_SCHEMA");
    const noPass = structuredClone(pursuit.math);
    noPass.entities[1].props.segments[0].velocity = "math:fact:vA";
    noPass.events[0].at = undefined;
    noPass.derived_facts = noPass.derived_facts.filter((f: any) => !["catch_time", "catch_position"].includes(f.fact_id));
    expectCode(() => compileMotion(noPass), "E_MATH_CONSTRAINT");
  });
});

describe("P3 pure random-access MotionSnapshot and generic Runtime", () => {
  it("returns identical snapshots in forward, reverse, and repeated random access", () => {
    const p = compileMotion(pursuit.math);
    const ctx = (modelTime: number) => ({ modelTime, env: {}, resolveBinding: () => undefined });
    const anchors = [0, 10, 20, 80 / 3, 30, 10, 0, 80 / 3];
    const states = anchors.map((t) => evaluateMotion(p, ctx(t)));
    expect(states[1]).toEqual(states[5]);
    expect(states[0]).toEqual(states[6]);
    expect(states[3]).toEqual(states[7]);
    expect(states[3].entities.A.position).toBeCloseTo(400 / 3, 12);
    expect(states[3].entities.B.position).toBeCloseTo(400 / 3, 12);
    expect(states[0].entities.B.active).toBe(false);
    expect(states[0].entities.B.position).toBe(0);
  });

  it("Runtime snapshot-first binding, scale transform, and SVG consume computed state", () => {
    const rt = loadRuntime(pursuit, { domains });
    const atCatch = rt.stateAt(12);
    expect(atCatch.modelTime).toBeCloseTo(80 / 3, 12);
    expect(atCatch.objects.body_A.resolvedBinding).toBeCloseTo(8 / 9, 12);
    expect(atCatch.objects.body_B.resolvedBinding).toBeCloseTo(8 / 9, 12);
    expect(atCatch.objects.catch_marker.resolvedBinding).toBeCloseTo(8 / 9, 12);
    expect(atCatch.digest).toMatch(/^[0-9a-f]{64}$/);
    const svg = renderSvg(atCatch, pursuit.scene);
    expect(svg).toContain("<line");
    expect(svg).toContain("<circle");
    expect(svg).toContain("event");
  });

  it("segment boundaries use half-open intervals and last endpoint closes; random access works", () => {
    const program = compileMotion(piecewise.math);
    const at = (t: number) => evaluateMotion(program, { modelTime: t, env: {}, resolveBinding: () => undefined }).entities.P;
    const before = at(9.999);
    const boundary10 = at(10);
    const boundary20 = at(20);
    const after20 = at(21);
    const final30 = at(30);
    expect(before.position).toBeCloseTo(49.995, 8);
    expect(boundary10.position).toBe(50);
    expect(boundary10.velocity).toBe(8);
    expect(boundary20.position).toBe(130);
    expect(boundary20.velocity).toBe(0);
    expect(boundary20.active).toBe(true);
    expect(after20.position).toBe(130);
    expect(after20.velocity).toBe(0);
    expect(after20.active).toBe(true);
    expect(final30.position).toBe(130);
    expect(final30.active).toBe(false);
  });

  it("head-on event state is equal and repeatable", () => {
    const runtimeDoc = structuredClone(meeting);
    runtimeDoc.scene.objects = runtimeDoc.scene.objects.filter((o: any) => o.objectId !== "meeting_marker");
    const rt = loadRuntime(runtimeDoc, { domains });
    const s = rt.stateAt(10);
    expect(s.objects.body_A.resolvedBinding).toBeCloseTo(0.5, 12);
    expect(s.objects.body_B.resolvedBinding).toBeCloseTo(0.5, 12);
    const digest = rt.stateAt(0).digest;
    expect(rt.stateAt(0).digest).toBe(digest);
  });
});
