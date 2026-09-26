import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadRuntime } from "./runtime";
import { canonicalSerialize } from "./digest";
import { summarizeGates } from "./gate-summary";
import { motion1dAdapter } from "../../domains/motion1d/src/adapter";
import { compileMotion } from "../../domains/motion1d/src/compile";
import { evaluateMotion } from "../../domains/motion1d/src/evaluate";
import { checkMotionInvariants } from "../../domains/motion1d/src/invariants";
import { runCase } from "../../contracts/src/gates";
import { renderSvg } from "../../renderer-svg/src/render";

const ROOT = path.resolve(__dirname, "../../..");
const require = createRequire(import.meta.url);
function findChrome(): string | null {
  if (process.env.MATHVIZ_TEST_NO_CHROME === "1") return null;
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
function browserDigest(chrome: string, frame: number): { digest: string; rendered: string } {
  const html = path.join(ROOT, "examples", "p3", "dist", "index.html");
  const { execFileSync } = require("node:child_process");
  const out = execFileSync(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--dump-dom", `file:///${html.replace(/\\/g, "/")}?frame=${frame}`], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  const d = /<body[^>]*data-rendered="([^"]+)"[^>]*data-state-digest="([0-9a-f]+)"/i.exec(out);
  if (!d) throw new Error(`G10: failed to read state digest for frame ${frame}`);
  return { digest: d[2], rendered: d[1] };
}

async function main() {
  const files = ["pursuit", "meeting", "piecewise", "catch-stopped"];
  const fixtures = Object.fromEntries(files.map((name) => [name, JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/p3", `${name}.compiled.json`), "utf8"))]));
  const invalidFixture = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/p3/invalid-piecewise-teleport.compiled.json"), "utf8"));
  const domains = { motion1d: motion1dAdapter };
  const gates: any[] = [];
  const cases: any[] = [];
  for (const name of files) {
    const doc = fixtures[name];
    const result = runCase({ case_id: `p3-${name}`, kind: "project", expect: "pass", doc });
    cases.push(result);
    gates.push({ gate: `G1_G2_G3_G6_G9_${name}`, status: result.ok ? "PASS" : "FAIL", emitted_error_codes: result.emitted_error_codes });
  }

  const invalidContracts = runCase({ case_id: "p3-invalid-teleport-contract", kind: "project", expect: "pass", doc: invalidFixture });
  let invalidMotionCode: string | null = null;
  try { compileMotion(invalidFixture.math); } catch (e: any) { invalidMotionCode = e?.code ?? null; }
  gates.push({ gate: "G12_invalid-teleport", status: invalidContracts.ok && invalidMotionCode === "E_MATH_CONSTRAINT" ? "PASS" : "FAIL", contract_codes: invalidContracts.emitted_error_codes, motion_code: invalidMotionCode });

  const p = compileMotion(fixtures.pursuit.math);
  const pursuitRt = loadRuntime(fixtures.pursuit, { domains });
  // P3.1 A5 — domain truth and runtime/timeline mapping are reported as
  // separate vector families; arbitrary model times are no longer pushed
  // through an ad-hoc presentation mapping to manufacture a RuntimeState.
  const domainAnchors = [0, 1, 9.999, 10, 20, 79 / 3, 80 / 3, 81 / 3, 30];
  const domainVectors = domainAnchors.map((modelTime) => {
    const snapshot = evaluateMotion(p, { modelTime, env: {}, resolveBinding: () => undefined });
    return { model_time: modelTime, snapshot_digest: snapshot.digest, A: snapshot.entities.A, B: snapshot.entities.B };
  });
  const runtimeFrames = [0, 48, 120, 216, 288, 360, 432];
  const runtimeVectors = runtimeFrames.map((frame) => {
    const state = pursuitRt.stateAtFrame(frame);
    return { frame, presentation_time: state.presentationTime, mapped_model_time: state.modelTime, state_digest: state.digest };
  });
  const eventSolutions = Object.fromEntries(files.map((name) => {
    const program = compileMotion(fixtures[name].math);
    return [name, program.events.map((e) => ({ event_id: e.eventId, capability_id: e.capabilityId, participants: e.participants, time: e.time, position: e.position }))];
  }));
  const invalids = [
    { id: "derived-time-mismatch", file: "pursuit", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "catch_time").value = { kind: "int", value: "27" }; }, code: "E_MATH_ASSERTION" },
    { id: "unit-dimension-mismatch", file: "pursuit", mutate: (d: any) => { d.math.source_facts.find((f: any) => f.fact_id === "vB_raw").unit = "m"; }, code: "E_MATH_CONSTRAINT" },
    { id: "wrong-derived-position", file: "meeting", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "meet_pos").value = { kind: "int", value: "51" }; }, code: "E_MATH_ASSERTION" }
  ];
  for (const invalid of invalids) {
    const doc = structuredClone(fixtures[invalid.file]);
    invalid.mutate(doc);
    try {
      loadRuntime(doc, { domains });
      gates.push({ gate: `G12_${invalid.id}`, status: "FAIL", expected_error: invalid.code, actual_error: null });
    } catch (e: any) {
      gates.push({ gate: `G12_${invalid.id}`, status: e?.code === invalid.code ? "PASS" : "FAIL", expected_error: invalid.code, actual_error: e?.code ?? e?.message });
    }
  }
  for (const name of files) {
    const program = compileMotion(fixtures[name].math);
    const times = [...new Set([0, 1, 2, 9.999, 10, 15, 20, 25, 30, ...program.events.map((e) => Number(e.time.p) / Number(e.time.q))])];
    const checks = checkMotionInvariants(program, times);
    gates.push({ gate: `G12_invariants_${name}`, status: checks.length > 0 && checks.every((x) => x.pass) ? "PASS" : "FAIL", checks });
  }

  let repeatsOk = true;
  for (const name of files) {
    const rt = loadRuntime(fixtures[name], { domains });
    const anchorsForCase = name === "pursuit" ? [0, 10, 80 / 3, 30] : name === "meeting" ? [0, 5, 10] : name === "catch-stopped" ? [0, 10, 15, 20] : [0, 10, 20, 30];
    for (const t of anchorsForCase) {
      const first = rt.stateAt(t).digest;
      for (let i = 0; i < 100; i++) if (rt.stateAt(t).digest !== first) repeatsOk = false;
    }
  }
  gates.push({ gate: "G9_motion_determinism_100x", status: repeatsOk ? "PASS" : "FAIL", anchors: domainAnchors.length });

  const pursuitFrames = [48, 72, 120, 216, 288, 336];
  let g10: any = { gate: "G10_cross_output_consistency", browser: "NOT FOUND", frames: [], status: "PASS" };
  const chrome = findChrome();
  const allowBrowserSkip = process.env.ALLOW_BROWSER_SKIP === "1";
  g10.browser = chrome ?? "NOT FOUND";
  if (!chrome) {
    g10.status = allowBrowserSkip ? "SKIP" : "INCOMPLETE";
    g10.note = allowBrowserSkip ? "development-only G10 skip explicitly allowed; this run is INCOMPLETE" : "Chrome not found; required G10 was not executed";
  } else {
    for (const frame of pursuitFrames) {
      const node = pursuitRt.stateAtFrame(frame);
      const br = browserDigest(chrome, frame);
      const ok = br.digest === node.digest && br.rendered === String(frame);
      g10.frames.push({ frame, node_digest: node.digest, browser_digest: br.digest, rendered: br.rendered, ok });
      if (!ok) g10.status = "FAIL";
    }
  }
  gates.push(g10);

  const svg = renderSvg(pursuitRt.stateAt(12), fixtures.pursuit.scene);
  const invariants = { no_previous_frame_accumulation: true, no_llm: true, renderer_math: false, runtime_domain_branch: false, compile_once_digest: p.digest };
  const artifacts = path.join(ROOT, "runs", "p3");
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, "gates.json"), canonicalSerialize({ fixtures: files, results: gates, summary: summarizeGates(gates, allowBrowserSkip).summary }) + "\n", "utf8");
  fs.writeFileSync(path.join(artifacts, "motion-vectors.json"), canonicalSerialize({ domain_vectors: domainVectors, runtime_vectors: runtimeVectors, invariants, svg_sha256: require("node:crypto").createHash("sha256").update(svg).digest("hex") }) + "\n", "utf8");
  fs.writeFileSync(path.join(artifacts, "event-solutions.json"), canonicalSerialize(eventSolutions) + "\n", "utf8");
  console.log(`P3 report: ${artifacts}`);
  const summary = summarizeGates(gates, allowBrowserSkip);
  console.log(`P3 GATES: ${summary.summary}`);
  process.exitCode = summary.exitCode;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
