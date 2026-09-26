import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadRuntime } from "../packages/runtime/src/runtime";
import { compileTimeline } from "../packages/runtime/src/timeline/compile";
import { evalExpr } from "../packages/runtime/src/expr/evaluate";
import { modelTimeAt } from "../packages/runtime/src/timeline/model-time";
import { renderSvg } from "../packages/renderer-svg/src/render";
import { VizRuntimeError } from "../packages/runtime/src/errors";

const ROOT = path.resolve(__dirname, "..");
const project = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "p1", "minimal-motion.compiled.json"), "utf8"));

function tl(actions: any[], duration = 8, fps = 30) {
  return compileTimeline({
    schemaVersion: "mathviz.timeline/v1",
    timelineId: "tl_test",
    duration,
    fps,
    tracks: [{ track_id: "t", actions }]
  });
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e: any) {
    expect(e).toBeInstanceOf(VizRuntimeError);
    expect(e.code).toBe(code);
    return;
  }
  throw new Error(`expected VizRuntimeError ${code}, got no throw`);
}

describe("P1 acceptance: timeline mapping semantics", () => {
  const rt = loadRuntime(project);

  it("maps model time linearly across [2,6) — start/mid/end", () => {
    expect(rt.stateAt(2).modelTime).toBe(0);
    expect(rt.stateAt(4).modelTime).toBeCloseTo(0.5, 12);
    expect(rt.stateAt(5.999999).modelTime).toBeCloseTo(0.9999995, 6);
    expect(rt.stateAt(6).modelTime).toBe(1); // last window is closed
  });

  it("returns modelTime=null outside every mapping window", () => {
    expect(rt.stateAt(0).modelTime).toBeNull();
    expect(rt.stateAt(1).modelTime).toBeNull();
    expect(rt.stateAt(7).modelTime).toBeNull();
    expect(rt.stateAt(8).modelTime).toBeNull();
  });

  it("half-open windows: shared boundary hits exactly one window", () => {
    const w = [
      { from: 0, to: 2, modelFrom: 0, modelTo: 1 },
      { from: 2, to: 4, modelFrom: 1, modelTo: 2 }
    ];
    expect(modelTimeAt(w, 2)).toBe(1); // second window owns t=2
    expect(modelTimeAt(w, 1.9999)).toBeCloseTo(0.99995, 6);
  });
});

describe("P1 acceptance: seek / play / pause / random access", () => {
  const rt = loadRuntime(project);

  it("seek forward and backward digests equal direct stateAt", () => {
    const p = rt.createPlayer();
    p.seek(4.5);
    expect(p.getState().digest).toBe(rt.stateAt(4.5).digest);
    p.seek(1); // backward
    expect(p.getState().digest).toBe(rt.stateAt(1).digest);
  });

  it("setFrame(n) === stateAt(n / fps) for arbitrary frames", () => {
    for (const n of [0, 7, 60, 91, 137, 179, 240]) {
      expect(rt.stateAtFrame(n).digest).toBe(rt.stateAt(n / rt.fps).digest);
    }
  });

  it("rejects out-of-range frames", () => {
    expectCode(() => rt.stateAtFrame(-1), "E_SCHEMA");
    expectCode(() => rt.stateAtFrame(241), "E_SCHEMA");
    expectCode(() => rt.stateAtFrame(60.5), "E_SCHEMA");
  });

  it("pause freezes the state; getState stays byte-identical", () => {
    const p = rt.createPlayer();
    p.seek(3.25);
    p.play();
    p.tick(0.5);
    p.pause();
    const a = p.getState().digest;
    const b = p.getState().digest;
    const c = p.getState().digest;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("play advances THROUGH stateAt — ticked state equals direct evaluation", () => {
    const p = rt.createPlayer();
    p.play();
    p.tick(2); // exactly at mapping start
    expect(p.getState().digest).toBe(rt.stateAt(2).digest);
    p.tick(2.5);
    expect(p.getState().digest).toBe(rt.stateAt(4.5).digest);
  });

  it("same frame 100 times: digest identical", () => {
    const d = rt.stateAtFrame(120).digest;
    for (let i = 0; i < 100; i++) expect(rt.stateAtFrame(120).digest).toBe(d);
  });

  it("P2.1 preserves every frozen P1 digest vector when no DomainSnapshot exists", () => {
    const known: Record<number, string> = {
      0: "24a9c173a5918780d4e44c8995825b4bcfeaced3845d403da59b2d241e7df993",
      60: "94e640b65f81550a4b8056c97afd8aa79400ab47c9cb6d110dee3714d7bef9d7",
      90: "5703c3b83ae51e1da575fbe6c15b002ae6d12903e5dc86564a329f243ee36fa3",
      120: "8affc36505d3a4eee4f9c060349a4afe2656fd9657e4e20eb3a07b6710fbb696",
      150: "db028047939ff09933db0488493284eea7b63be0741ef8fa076ea84a1f6eab5d",
      180: "7c1e4b618f88c2342af4a05779cd701e3dcf760158108b93ddc085644ab83488",
      240: "34638bbd0057377d6fccc853a2752309024cd84e51d6ca39c621311384283a57"
    };
    for (const [frame, digest] of Object.entries(known)) {
      expect(rt.stateAtFrame(Number(frame)).digest).toBe(digest);
    }
  });
});

describe("P1 acceptance: timeline compile rejections", () => {
  const map = (from: number, to: number) => ({
    kind: "map_model_time", from, to,
    model_from: { t: "num", v: { kind: "int", value: "0" } },
    model_to: { t: "num", v: { kind: "int", value: "1" } }
  });

  it("overlapping map_model_time -> E_NONDETERMINISTIC", () => {
    expectCode(() => tl([map(2, 6), map(5, 7)]), "E_NONDETERMINISTIC");
  });
  it("touching windows [0,2)+[2,4] are fine", () => {
    expect(() => tl([map(0, 2), map(2, 4)])).not.toThrow();
  });
  it("conflicting show/hide at same target+timestamp -> E_NONDETERMINISTIC", () => {
    expectCode(() => tl([
      { kind: "show", target: "a", at: 1 },
      { kind: "hide", target: "a", at: 1 }
    ]), "E_NONDETERMINISTIC");
  });
  it("same-kind duplicates are idempotent (no conflict)", () => {
    expect(() => tl([
      { kind: "show", target: "a", at: 1 },
      { kind: "show", target: "a", at: 1 }
    ])).not.toThrow();
  });
  it("caption overlap -> E_NONDETERMINISTIC", () => {
    expectCode(() => tl([
      { kind: "caption", at: 1, until: 3, text: "a" },
      { kind: "caption", at: 2, until: 4, text: "b" }
    ]), "E_NONDETERMINISTIC");
  });
  it("two cameras at the same timestamp -> E_NONDETERMINISTIC", () => {
    expectCode(() => tl([
      { kind: "camera", at: 2, zoom: 2 },
      { kind: "camera", at: 2, zoom: 3 }
    ]), "E_NONDETERMINISTIC");
  });
  it("action beyond duration -> E_SCHEMA", () => {
    expectCode(() => tl([{ kind: "show", target: "a", at: 9 }]), "E_SCHEMA");
    expectCode(() => tl([map(0, 9)]), "E_SCHEMA");
  });
  it("until <= at -> E_SCHEMA; until beyond duration -> E_SCHEMA", () => {
    expectCode(() => tl([{ kind: "caption", at: 2, until: 2, text: "x" }]), "E_SCHEMA");
    expectCode(() => tl([{ kind: "caption", at: 2, until: 9, text: "x" }]), "E_SCHEMA");
  });
});

describe("P1 acceptance: expression evaluator", () => {
  const E = (ast: any, env: any = {}) => evalExpr(ast, env);

  it("stays exact over rationals: 1/3 + 1/6 === 1/2", () => {
    const v = E({ t: "app", op: "+", args: [
      { t: "num", v: { kind: "rational", p: "1", q: "3" } },
      { t: "num", v: { kind: "rational", p: "1", q: "6" } }
    ] });
    if (v.kind !== "exact") throw new Error("expected exact");
    expect(v.r.p).toBe(1n);
    expect(v.r.q).toBe(2n);
  });

  it("integer power stays exact; negative exponent inverts", () => {
    const v = E({ t: "app", op: "^", args: [
      { t: "num", v: { kind: "rational", p: "2", q: "1" } },
      { t: "num", v: { kind: "int", value: "-2" } }
    ] });
    if (v.kind !== "exact") throw new Error("expected exact");
    expect(v.r.p).toBe(1n);
    expect(v.r.q).toBe(4n);
  });

  it("transcendentals are deterministic numeric", () => {
    const v = E({ t: "app", op: "sin", args: [{ t: "num", v: { kind: "int", value: "0" } }] });
    if (v.kind !== "num") throw new Error("expected num");
    expect(v.v).toBe(0);
  });

  it("missing symbol -> E_BINDING", () => {
    expectCode(() => E({ t: "sym", name: "zzz" }), "E_BINDING");
  });
  it("division by zero -> E_MATH_CONSTRAINT (exact and numeric)", () => {
    expectCode(() => E({ t: "app", op: "/", args: [
      { t: "num", v: { kind: "int", value: "1" } },
      { t: "num", v: { kind: "int", value: "0" } }
    ] }), "E_MATH_CONSTRAINT");
  });
  it("sqrt(negative) / ln(non-positive) / asin(2) -> E_MATH_CONSTRAINT", () => {
    expectCode(() => E({ t: "app", op: "sqrt", args: [{ t: "num", v: { kind: "int", value: "-1" } }] }), "E_MATH_CONSTRAINT");
    expectCode(() => E({ t: "app", op: "ln", args: [{ t: "num", v: { kind: "int", value: "0" } }] }), "E_MATH_CONSTRAINT");
    expectCode(() => E({ t: "app", op: "asin", args: [{ t: "num", v: { kind: "int", value: "2" } }] }), "E_MATH_CONSTRAINT");
  });
  it("pi resolves as a symbolic constant", () => {
    const v = E({ t: "sym", name: "pi" });
    if (v.kind !== "num") throw new Error("expected num");
    expect(v.v).toBeCloseTo(Math.PI, 15);
  });
});

describe("P1 acceptance: bindings", () => {
  it("property path missing -> E_BINDING", () => {
    const rt2 = loadRuntime(JSON.parse(JSON.stringify(project)));
    rt2; // base project resolves fine
    const bad = JSON.parse(JSON.stringify(project));
    bad.scene.objects[1].binding.source = "math:entity:P_point.nope";
    expectCode(() => loadRuntime(bad).stateAt(4), "E_BINDING");
  });

  it("unsupported presentation transform remains explicit E_CAPABILITY_UNSUPPORTED", () => {
    const bad = JSON.parse(JSON.stringify(project));
    bad.scene.objects[1].binding.transform = { kind: "screen_offset", params: {} };
    expectCode(() => loadRuntime(bad).stateAt(4), "E_CAPABILITY_UNSUPPORTED");
  });

  it("runtime binding resolves model time; outside mapping it is null", () => {
    const rt2 = loadRuntime(project);
    expect(rt2.stateAt(4).objects.obj_P.resolvedBinding).toBeCloseTo(0.5, 12);
    expect(rt2.stateAt(1).objects.obj_P.resolvedBinding).toBeNull();
    expect(rt2.stateAt(7).objects.obj_P.resolvedBinding).toBeNull();
  });
});

describe("P1 acceptance: renderer is a thin paint layer", () => {
  const rt2 = loadRuntime(project);

  it("renderSvg consumes ONLY (RuntimeState, SceneIR) — no math, no timeline", () => {
    const state = rt2.stateAtFrame(120);
    const sceneOnly = JSON.parse(JSON.stringify(project.scene)); // scene IR in isolation
    const svg = renderSvg(state, sceneOnly);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("</svg>");
    // determinism: same inputs -> identical bytes
    expect(renderSvg(state, sceneOnly)).toBe(svg);
  });

  it("hidden objects are not painted", () => {
    const hidden = JSON.parse(JSON.stringify(project));
    hidden.timeline.tracks[1].actions.push({ kind: "hide", target: "obj_P", at: 1 });
    const rtHidden = loadRuntime(hidden);
    const svg = renderSvg(rtHidden.stateAt(4), hidden.scene);
    expect(svg).not.toContain('r="5"');
  });
});

describe("P1 acceptance: player page and fixture stay in sync", () => {
  it("index.html inline project is canonically identical to the fixture file", () => {
    const html = fs.readFileSync(path.join(ROOT, "examples", "p1", "index.html"), "utf8");
    const m = /window\.__MATHVIZ_PROJECT__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
    expect(m, "inline project object not found").toBeTruthy();
    const inline = JSON.parse(m![1]);
    expect(JSON.stringify(inline)).toBe(JSON.stringify(project));
  });
});
