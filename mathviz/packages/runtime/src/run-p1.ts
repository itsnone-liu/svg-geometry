// P1 gate runner (node side):
//   G9-strengthen — repeat stateAt at fixed sample times 100x; digests identical
//   G10           — cross-output consistency: node stateAtFrame(n).digest vs
//                   browser window.mathviz.setFrame(n) digest (chrome --dump-dom,
//                   reading data-state-digest off <body>)
// Artifacts: mathviz/runs/p1/{gates.json,state-vectors.json,digest-vectors.json}

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadRuntime } from "./runtime";
import { canonicalSerialize } from "./digest";
import { summarizeGates } from "./gate-summary";

const ROOT = path.resolve(__dirname, "..", "..", "..");

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
  const url = "file:///" + path.join(ROOT, "examples", "p1", "index.html").replace(/\\/g, "/") + `?frame=${frame}`;
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
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "p1", "minimal-motion.compiled.json"), "utf8"));
  const rt = loadRuntime(project);
  const maxFrame = Math.floor(rt.duration * rt.fps);

  console.log("== MathViz P1 gates ==");
  console.log(`project digest: ${rt.projectDigest}`);
  console.log(`duration: ${rt.duration}s  fps: ${rt.fps}  frames: 0..${maxFrame}`);

  // ---- G9 strengthen: determinism at fixed sample times, 100 repetitions ----
  const sampleTimes = [0, 1, 2, 4, 6 - 1e-6, 8].map(x => Math.min(x, rt.duration));
  const g9: any = { gate: "G9_runtime_determinism", samples: [], status: "PASS" };
  for (const t of sampleTimes) {
    let first: string | null = null;
    let stable = true;
    for (let i = 0; i < 100; i++) {
      const d = rt.stateAt(t).digest;
      if (first === null) first = d;
      else if (d !== first) stable = false;
    }
    g9.samples.push({ t, digest: first, stable });
    if (!stable) g9.status = "FAIL";
  }
  console.log(`${g9.status === "PASS" ? "OK  " : "BAD "} G9 runtime determinism (100x per sample time)`);

  // ---- known vectors: >= 5 frames across the whole timeline ----
  const frames = [0, 60, 90, 120, 150, 180, 240];
  const stateVectors: any[] = [];
  const digestVectors: any[] = [];
  for (const f of frames) {
    const s = rt.stateAtFrame(f);
    stateVectors.push({ frame: f, state: s });
    digestVectors.push({ frame: f, presentation_time: s.presentationTime, model_time: s.modelTime, state_digest: s.digest });
    console.log(`     frame ${String(f).padStart(3)}  t=${s.presentationTime.toFixed(4)}  model=${s.modelTime === null ? "null" : s.modelTime.toFixed(6)}  ${s.digest.slice(0, 16)}…`);
  }

  // ---- G10 cross-output consistency (node runtime vs browser bundle) ----
  const chrome = findChrome();
  const allowBrowserSkip = process.env.ALLOW_BROWSER_SKIP === "1";
  const g10: any = { gate: "G10_cross_output_consistency", browser: chrome ?? "NOT FOUND", frames: [], status: "PASS" };
  if (!chrome) {
    g10.status = allowBrowserSkip ? "SKIP" : "INCOMPLETE";
    g10.note = allowBrowserSkip
      ? "development-only G10 skip explicitly allowed; this run is INCOMPLETE"
      : "Chrome not found; required G10 was not executed";
    console.log(allowBrowserSkip ? "WARN G10 development skip allowed; run is INCOMPLETE" : "INCOMPLETE G10: Chrome executable not found");
  } else {
    for (const f of frames) {
      const node = rt.stateAtFrame(f);
      const br = browserDigest(chrome, f);
      const ok = br.digest === node.digest && br.rendered === String(f);
      g10.frames.push({ frame: f, node_digest: node.digest, browser_digest: br.digest, rendered: br.rendered, ok });
      if (!ok) g10.status = "FAIL";
    }
    console.log(`${g10.status === "PASS" ? "OK  " : "BAD "} G10 cross-output consistency (node vs chrome, ${frames.length} frames)`);
  }

  const summary = summarizeGates([g9, g10], allowBrowserSkip);
  const gates = { project: "fixtures/p1/minimal-motion.compiled.json", project_digest: rt.projectDigest, results: [g9, g10], summary: summary.summary };

  const outDir = path.join(ROOT, "runs", "p1");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "gates.json"), canonicalSerialize(gates) + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "state-vectors.json"), canonicalSerialize(stateVectors) + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "digest-vectors.json"), canonicalSerialize(digestVectors) + "\n", "utf8");

  console.log(`report: ${path.join(outDir, "gates.json")}`);
  console.log(`P1 GATES: ${summary.summary}`);
  process.exitCode = summary.exitCode;
}

main();
