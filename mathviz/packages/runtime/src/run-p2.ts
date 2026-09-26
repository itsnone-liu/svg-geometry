// P2 gate runner (node side):
//   G1/G2/G3/G6  contracts gates reused over the P2 fixtures (project kind)
//   G4           geometry compile/solve (valid compile + negative mutations)
//   G5           math assertions + verified marks (incl. invalid-geometry)
//   G9           runtime determinism at anchor times (100x)
//   vectors      9 rotation anchors (0..360 in 45 deg steps)
//   G10          cross-output: node digests vs chrome headless page digests
//   G11          oracle consistency vs pinned Geometry DSL kernel
// Artifacts: mathviz/runs/p2/{gates.json,geometry-vectors.json,oracle-comparison.json}

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadRuntime } from "./runtime";
import { canonicalSerialize } from "./digest";
import { summarizeGates } from "./gate-summary";
import { geometry2dAdapter, GEOMETRY_EPS, GEOMETRY_NUMERIC_POLICY, P2_CAPABILITIES } from "../../domains/geometry2d/src/adapter";
import { runCase } from "../../contracts/src/gates";
import { oracle, assertPinnedVendor, comparePoint } from "../../adapters/geometry-dsl/src/oracle";
import { ADAPTER_VERSION } from "../../adapters/geometry-dsl/src/version";
import { VizRuntimeError } from "./errors";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DOMAINS = { geometry2d: geometry2dAdapter };

function readJson(rel: string): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function expectCode(fn: () => unknown, code: string): boolean {
  try {
    fn();
    return false;
  } catch (e: any) {
    return e instanceof VizRuntimeError && e.code === code;
  }
}

function findChrome(): string | null {
  // Deterministic harness override for testing freeze/development skip paths.
  if (process.env.MATHVIZ_TEST_NO_CHROME === "1") return null;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.CHROME_PATH ?? ""
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function browserDigest(chrome: string, frame: number): { digest: string; rendered: string } {
  const url = "file:///" + path.join(ROOT, "examples", "p2", "index.html").replace(/\\/g, "/") + `?frame=${frame}`;
  const html = execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000", "--dump-dom", url], {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024
  });
  const d = /data-state-digest="([0-9a-f]{64})"/.exec(html);
  const r = /data-rendered-frame="(\d+)"/.exec(html);
  if (!d || !r) throw new Error(`browser output missing digest/frame attributes (frame=${frame})`);
  return { digest: d[1], rendered: r[1] };
}

function main(): void {
  const square = readJson("fixtures/p2/square-rotation.compiled.json");
  const statik = readJson("fixtures/p2/static-construction.compiled.json");
  const invalid = readJson("fixtures/p2/invalid-geometry.json");

  console.log("== MathViz P2 gates ==");
  const rtSquare = loadRuntime(square, { domains: DOMAINS });
  const rtStatic = loadRuntime(statik, { domains: DOMAINS });
  console.log(`square project digest: ${rtSquare.projectDigest}`);
  console.log(`static project digest: ${rtStatic.projectDigest}`);
  console.log(`numeric policy: ${GEOMETRY_NUMERIC_POLICY}; adapter ${ADAPTER_VERSION}`);
  const pin = assertPinnedVendor();
  console.log(`vendor pin: ${pin.pinned ? "OK" : "MISSING"} (${pin.head.slice(0, 7)})`);

  const results: any[] = [];

  // ---- G1/G2/G3/G6/G9 via the contracts case runner ----
  const contractRows: any[] = [];
  for (const [id, doc, expect, expectedCodes] of [
    ["p2-square-rotation", square, "pass", []],
    ["p2-static-construction", statik, "pass", []],
    ["p2-invalid-geometry", invalid.project, "pass", []]
  ] as Array<[string, any, string, string[]]>) {
    const r = runCase({ case_id: id, kind: "project", expect, doc, expected_error_codes: expectedCodes } as any);
    contractRows.push(r);
    console.log(`${r.ok ? "OK  " : "BAD "} G1-G3/G6/G9(contracts) ${id} gates=${r.gates.map((g: any) => `${g.gate.split("_")[0]}:${g.status[0]}`).join(" ")} emitted=[${r.emitted_error_codes.join(",")}]`);
  }
  results.push({ gate: "G1_G2_G3_G6_contracts", status: contractRows.every((r) => r.ok) ? "PASS" : "FAIL", rows: contractRows });

  // ---- G4: geometry compile/solve ----
  const g4neg: any[] = [];
  {
    const cyc = JSON.parse(JSON.stringify(square));
    cyc.math.entities.push({ id: "CYC1", kind: "dynamic_point", props: { capability_id: "geometry2d.rotate_point", center: "CYC2", source: "P", angle: "0", direction: "ccw" } });
    cyc.math.entities.push({ id: "CYC2", kind: "dynamic_point", props: { capability_id: "geometry2d.rotate_point", center: "CYC1", source: "P", angle: "0", direction: "ccw" } });
    g4neg.push({ case: "dependency-cycle", ok: expectCode(() => loadRuntime(cyc, { domains: DOMAINS }), "E_SCHEMA"), code: "E_SCHEMA" });

    const miss = JSON.parse(JSON.stringify(square));
    miss.math.entities.push({ id: "seg_bad", kind: "segment", props: { a: "NOPE", b: "B" } });
    g4neg.push({ case: "missing-entity-ref", ok: expectCode(() => loadRuntime(miss, { domains: DOMAINS }), "E_BINDING"), code: "E_BINDING" });

    const loc = JSON.parse(JSON.stringify(square));
    loc.math.entities.push({ id: "L1", kind: "dynamic_point", props: { capability_id: "geometry2d.locus", of: "E" } });
    loc.math.capabilities.push("geometry2d.locus");
    g4neg.push({
      case: "registry-id-but-unimplemented(locus)",
      ok: expectCode(() => loadRuntime(loc, { domains: DOMAINS }), "E_CAPABILITY_UNSUPPORTED"),
      code: "E_CAPABILITY_UNSUPPORTED"
    });

    const dyn = JSON.parse(JSON.stringify(square));
    dyn.math.entities.push({ id: "T1", kind: "point", props: { x: { t: "sym", name: "t" }, y: 0 } });
    g4neg.push({ case: "static-coord-references-t", ok: expectCode(() => loadRuntime(dyn, { domains: DOMAINS }), "E_SCHEMA"), code: "E_SCHEMA" });

    g4neg.push({ case: "missing-domain-adapter", ok: expectCode(() => loadRuntime(square), "E_CAPABILITY_UNSUPPORTED"), code: "E_CAPABILITY_UNSUPPORTED" });
  }
  const g4ok = g4neg.every((n) => n.ok);
  results.push({ gate: "G4_geometry_compile", status: g4ok ? "PASS" : "FAIL", negatives: g4neg, supports_locus: geometry2dAdapter.supports("geometry2d.locus"), p2_capability_count: P2_CAPABILITIES.size });
  console.log(`${g4ok ? "OK  " : "BAD "} G4 geometry compile (${g4neg.length} negative mutations + 2 valid compiles; supports(locus)=${geometry2dAdapter.supports("geometry2d.locus")})`);

  // ---- G5: assertions + verified marks ----
  const g5: any = { gate: "G5_math_assertions", status: "PASS", rows: [] };
  {
    // valid: evaluate across anchors — all assertions hold, marks verified
    let allPass = true;
    for (const t of [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12]) {
      try { rtSquare.stateAt(t); } catch { allPass = false; }
      try { rtStatic.stateAt(t / 3); } catch { allPass = false; }
    }
    g5.rows.push({ case: "valid-fixtures-assertions-hold", ok: allPass });

    // invalid fixture -> E_MATH_ASSERTION (both assertion FAIL and unverified mark)
    const okInv = expectCode(() => loadRuntime(invalid.project, { domains: DOMAINS }).stateAt(1), "E_MATH_ASSERTION");
    g5.rows.push({ case: "invalid-geometry-rejected", ok: okInv });

    // mark without matching assertion -> E_MATH_ASSERTION (never silently drawn)
    const noAssert = JSON.parse(JSON.stringify(square));
    noAssert.math.assertions = noAssert.math.assertions.filter((a: any) => a.capability_id !== "geometry2d.perpendicular");
    noAssert.math.constraints = noAssert.math.constraints.filter((a: any) => a.capability_id !== "geometry2d.perpendicular");
    const okNoA = expectCode(() => loadRuntime(noAssert, { domains: DOMAINS }).stateAt(1), "E_MATH_ASSERTION");
    g5.rows.push({ case: "mark-without-pass-assertion-rejected", ok: okNoA });

    const wrongFact = JSON.parse(JSON.stringify(square));
    wrongFact.scene.objects.find((o: any) => o.objectId === "obj_mark_right").binding.source = "math:entity:P";
    const okWrongFact = expectCode(() => loadRuntime(wrongFact, { domains: DOMAINS }).stateAt(1), "E_MATH_ASSERTION");
    g5.rows.push({ case: "mark-without-source-fact-rejected", ok: okWrongFact });

    // "forbidden" expectation honored: a TRUE perpendicular marked forbidden fails
    const forb = JSON.parse(JSON.stringify(statik));
    forb.math.assertions.push({ assertion_id: "assert_forb_perp", capability_id: "geometry2d.perpendicular", subject_refs: ["entity:B", "entity:F", "entity:A"], expectation: "forbidden" });
    const okForb = expectCode(() => loadRuntime(forb, { domains: DOMAINS }).stateAt(1), "E_MATH_ASSERTION");
    g5.rows.push({ case: "forbidden-expectation-violated", ok: okForb });

    g5.status = g5.rows.every((r: any) => r.ok) ? "PASS" : "FAIL";
  }
  console.log(`${g5.status === "PASS" ? "OK  " : "BAD "} G5 math assertions + verified marks (${g5.rows.map((r: any) => r.case + ":" + (r.ok ? "ok" : "BAD")).join(", ")})`);
  results.push(g5);

  // ---- 9 rotation anchors: vectors + G9 determinism ----
  const anchors: number[] = [];
  for (let k = 0; k <= 8; k++) anchors.push(1.5 * k); // theta = 45k deg, frames 36k
  const vectors: any[] = [];
  let g9ok = true;
  for (const t of anchors) {
    const s = rtSquare.stateAt(t);
    let first: string | null = null;
    for (let i = 0; i < 100; i++) {
      const d = rtSquare.stateAt(t).digest;
      if (first === null) first = d;
      else if (d !== first) g9ok = false;
    }
    vectors.push({
      t,
      frame: Math.round(t * rtSquare.fps),
      model_time: s.modelTime,
      theta_deg: s.modelTime === null ? null : (360 * s.modelTime),
      M: (s.objects.obj_M.resolvedBinding as any).position,
      N: (s.objects.obj_N.resolvedBinding as any).position,
      E: (s.objects.obj_E.resolvedBinding as any).position,
      geometry_snapshot_digest: s.domainDigest,
      runtime_state_digest: s.digest
    });
  }
  results.push({ gate: "G9_runtime_determinism", status: g9ok ? "PASS" : "FAIL", repeats: 100, anchors: anchors.length });
  console.log(`${g9ok ? "OK  " : "BAD "} G9 runtime determinism (100x at ${anchors.length} anchors)`);
  for (const v of vectors) {
    console.log(`     theta=${String(v.theta_deg.toFixed(0)).padStart(3)}deg  t=${v.t.toFixed(1).padStart(4)}  M=(${v.M.x.toFixed(3)},${v.M.y.toFixed(3)})  E=(${v.E.x.toFixed(3)},${v.E.y.toFixed(3)})  ${v.runtime_state_digest.slice(0, 12)}…`);
  }

  // ---- G10 cross-output consistency ----
  const chrome = findChrome();
  const allowBrowserSkip = process.env.ALLOW_BROWSER_SKIP === "1";
  const g10: any = { gate: "G10_cross_output_consistency", browser: chrome ?? "NOT FOUND", frames: [], status: "PASS" };
  if (!chrome) {
    g10.status = allowBrowserSkip ? "SKIP" : "INCOMPLETE";
    g10.note = allowBrowserSkip ? "development-only G10 skip explicitly allowed; this run is INCOMPLETE" : "Chrome not found; required G10 was not executed";
    console.log(allowBrowserSkip ? "WARN G10 development skip allowed; run is INCOMPLETE" : "INCOMPLETE G10: Chrome executable not found");
  } else {
    for (const v of vectors) {
      const node = rtSquare.stateAtFrame(v.frame);
      const br = browserDigest(chrome, v.frame);
      const ok = br.digest === node.digest && br.rendered === String(v.frame);
      g10.frames.push({ frame: v.frame, node_digest: node.digest, browser_digest: br.digest, rendered: br.rendered, ok });
      if (!ok) g10.status = "FAIL";
    }
    console.log(`${g10.status === "PASS" ? "OK  " : "BAD "} G10 cross-output consistency (node vs chrome, ${g10.frames.length} frames)`);
  }
  results.push(g10);

  // ---- G11 oracle consistency vs pinned Geometry DSL ----
  const g11: any = { gate: "G11_geometry_oracle", oracle: `shand001/geometry-dsl@${pin.head.slice(0, 7)}`, eps: GEOMETRY_EPS, rows: [], status: "PASS" };
  if (!pin.pinned) {
    g11.status = "SKIP";
    g11.note = "vendor not at pinned commit";
    console.log("WARN G11 skipped: vendor pin mismatch");
  } else {
    const P = (rtSquare.stateAt(0).objects.obj_P.resolvedBinding as any).position;
    const Q = (rtSquare.stateAt(0).objects.obj_Q.resolvedBinding as any).position;
    const B = (rtSquare.stateAt(0).objects.obj_B.resolvedBinding as any).position;
    const D = (rtSquare.stateAt(0).objects.obj_D.resolvedBinding as any).position;
    for (const v of vectors) {
      const theta = (2 * Math.PI * v.model_time) as number;
      const signed = -theta; // fixture rotates cw; adapter convention ccw-positive
      g11.rows.push(comparePoint("rotate", `M@${v.theta_deg.toFixed(0)}deg`, v.M, oracle.rotateAround(P, B, signed), GEOMETRY_EPS));
      g11.rows.push(comparePoint("rotate", `N@${v.theta_deg.toFixed(0)}deg`, v.N, oracle.rotateAround(Q, B, signed), GEOMETRY_EPS));
      g11.rows.push(comparePoint("midpoint", `E@${v.theta_deg.toFixed(0)}deg`, v.E, oracle.midpoint(v.N, D), GEOMETRY_EPS));
    }
    const s2 = rtStatic.stateAt(2);
    const pos = (oid: string) => (s2.objects[oid].resolvedBinding as any).position;
    g11.rows.push(comparePoint("midpoint", "static:M1", pos("obj_M1"), oracle.midpoint(pos("obj_B"), pos("obj_C")), GEOMETRY_EPS));
    g11.rows.push(comparePoint("midpoint", "static:M2", pos("obj_M2"), oracle.midpoint(pos("obj_A"), pos("obj_C")), GEOMETRY_EPS));
    g11.rows.push(comparePoint("projection", "static:F", pos("obj_F"), oracle.projection(pos("obj_A"), { a: pos("obj_B"), b: pos("obj_C") }), GEOMETRY_EPS));
    g11.rows.push(comparePoint("intersection", "static:I", pos("obj_I"), oracle.intersection(
      { a: pos("obj_A"), b: pos("obj_M1") },
      { a: pos("obj_B"), b: pos("obj_M2") }
    ), GEOMETRY_EPS));
    g11.status = g11.rows.every((r: any) => r.ok) ? "PASS" : "FAIL";
    const worst = Math.max(...g11.rows.map((r: any) => r.delta));
    console.log(`${g11.status === "PASS" ? "OK  " : "BAD "} G11 geometry oracle vs pinned Geometry DSL (${g11.rows.length} comparisons, worst delta ${worst.toExponential(2)} <= eps ${GEOMETRY_EPS})`);
  }
  results.push(g11);

  const summary = summarizeGates(results, allowBrowserSkip && pin.pinned);

  const outDir = path.join(ROOT, "runs", "p2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "gates.json"), canonicalSerialize({ generated_by: "run-p1.ts lineage", fixtures: ["square-rotation", "static-construction", "invalid-geometry"], numeric_policy: GEOMETRY_NUMERIC_POLICY, adapter: ADAPTER_VERSION, vendor_pin: pin, results, summary: summary.summary }) + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "geometry-vectors.json"), canonicalSerialize({ project_digest: rtSquare.projectDigest, fps: rtSquare.fps, vectors }) + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "oracle-comparison.json"), canonicalSerialize(g11) + "\n", "utf8");

  console.log(`report: ${path.join(outDir, "gates.json")}`);
  console.log(`P2 GATES: ${summary.summary}`);
  process.exitCode = summary.exitCode;
}

main();
