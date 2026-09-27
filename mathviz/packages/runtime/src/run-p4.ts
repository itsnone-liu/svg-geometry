// P4 freeze gate runner: Function2D + SymPy oracle.
//
// Gates
//   G1/G2/G3/G6/G9(contract)  per fixture (contracts runCase)
//   G14_cartesian_window      exactly-one cartesian_window semantic rule (+ negatives)
//   G14_compile_negatives     fail-closed compile rejections (wrong roots/…)
//   G14_invariants_<fixture>  sampled points == eval, root/vertex claims under
//                             CURRENT params, parameter sweep == runtime binding
//   G9_function_determinism   100x random-access digest stability
//   G13_function_sympy_oracle independent CAS re-derivation of every frozen
//                             claim + TS-vs-SymPy derivative cross-check
//                             (freeze-required: no python/sympy != pinned =>
//                              INCOMPLETE, never green)
//   G10_cross_output_consistency node vs Chrome parity on >= 9 frames
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadRuntime } from "./runtime";
import { canonicalSerialize } from "./digest";
import { summarizeGates } from "./gate-summary";
import { function2dAdapter } from "../../domains/function2d/src/adapter";
import { compileFunction } from "../../domains/function2d/src/compile";
import { assertFunctions } from "../../domains/function2d/src/assertions";
import { evaluateFunction } from "../../domains/function2d/src/evaluate";
import { differentiate } from "../../domains/function2d/src/differentiate";
import { sampleFunction } from "../../domains/function2d/src/sampling";
import { checkCartesianWindow } from "../../domains/function2d/src/layout";
import { FUNCTION_SAMPLE_COUNT, FUNCTION_EPS } from "../../domains/function2d/src/constants";
import type { VerifiedFunctionProgram } from "../../domains/function2d/src/types";
import { SympyClient } from "../../adapters/sympy/src/client";
import { SympyOracle } from "../../adapters/sympy/src/oracle";
import { PINNED_SYMPY_VERSION } from "../../adapters/sympy/src/version";
import { runCase } from "../../contracts/src/gates";
import { renderSvg } from "../../renderer-svg/src/render";
import { evalExpr } from "./expr/evaluate";
import { ratToNumber } from "./expr/exact";
import type { Rat } from "./expr/exact";
import { buildEnv, resolveSource } from "./bindings/resolve";

const ROOT = path.resolve(__dirname, "../../..");
const require = createRequire(import.meta.url);
let activeSympyClient: SympyClient | null = null;

function findChrome(): string | null {
  if (process.env.MATHVIZ_TEST_NO_CHROME === "1") return null;
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
function browserDigest(chrome: string, frame: number): { digest: string; domainDigest: string; rendered: string } {
  const html = path.join(ROOT, "examples", "p4", "dist", "index.html");
  const { execFileSync } = require("node:child_process");
  const out = execFileSync(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--dump-dom", `file:///${html.replace(/\\/g, "/")}?frame=${frame}`], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  const d = /<body[^>]*data-rendered="([^"]+)"[^>]*data-state-digest="([0-9a-f]+)"[^>]*data-domain-digest="([0-9a-f]+|null)"/i.exec(out);
  if (!d) throw new Error(`G10: failed to read state/domain digest for frame ${frame}`);
  return { digest: d[2], domainDigest: d[3], rendered: d[1] };
}

// ---------- value helpers (shared with G13 comparisons) ----------
function exactRatio(v: any): [bigint, bigint] | null {
  if (!v || typeof v !== "object") return null;
  if (v.kind === "int" && typeof v.value === "string") return [BigInt(v.value), 1n];
  if (v.kind === "rational" && typeof v.p === "string" && typeof v.q === "string" && v.q !== "0") {
    let p = BigInt(v.p), q = BigInt(v.q);
    if (q < 0n) { p = -p; q = -q; }
    return [p, q];
  }
  return null;
}
function valueKey(v: any, env: Record<string, number>): string {
  const r = exactRatio(v);
  if (r) return ((Number(r[0]) / Number(r[1])).toFixed(12));
  try {
    const e: any = {};
    for (const [k, n] of Object.entries(env)) e[k] = { kind: "num", v: n };
    const val = evalExpr(v.expr, e);
    const num = val.kind === "exact" ? ratToNumber(val.r as Rat) : val.v;
    if (Number.isFinite(num)) return num.toFixed(12);
  } catch { /* fall through to structural key */ }
  return "sym:" + canonicalSerialize(v.expr ?? v);
}
function numericOf(v: any, env: Record<string, number>): number | null {
  const r = exactRatio(v);
  if (r) return Number(r[0]) / Number(r[1]);
  try {
    const e: any = {};
    for (const [k, n] of Object.entries(env)) e[k] = { kind: "num", v: n };
    const val = evalExpr(v.expr, e);
    const num = val.kind === "exact" ? ratToNumber(val.r as Rat) : val.v;
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

async function main() {
  const files = ["quadratic-sweep", "intersections", "derivative-extrema", "equation"];
  const fixtures: Record<string, any> = Object.fromEntries(files.map((name) => [name, JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/p4", `${name}.compiled.json`), "utf8"))]));
  const invalidFixture = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/p4/invalid-function.compiled.json"), "utf8"));
  const domains = { function2d: function2dAdapter };
  const gates: any[] = [];
  const sympyOracleLog: any = { pinned: PINNED_SYMPY_VERSION, sympy_version: null, rows: [] };

  // ---------- contract gates ----------
  for (const name of files) {
    const result = runCase({ case_id: `p4-${name}`, kind: "project", expect: "pass", doc: fixtures[name] });
    gates.push({ gate: `G1_G2_G3_G6_G9_${name}`, status: result.ok ? "PASS" : "FAIL", emitted_error_codes: result.emitted_error_codes });
  }
  const invalidContracts = runCase({ case_id: "p4-invalid-function-contract", kind: "project", expect: "pass", doc: invalidFixture });
  let invalidCompileOk = true;
  try { compileFunction(invalidFixture.math); } catch { invalidCompileOk = false; }

  // ---------- G14: cartesian_window semantic rule ----------
  {
    const checks: any[] = [];
    for (const name of files) {
      try {
        const w = checkCartesianWindow(fixtures[name].scene);
        checks.push({ case: name, ok: true, window: w });
      } catch (e: any) {
        checks.push({ case: name, ok: false, error: e?.message });
      }
    }
    const mutations = [
      { id: "missing-window", mutate: (s: any) => { s.layoutRules = []; }, code: "E_LAYOUT" },
      { id: "duplicate-window", mutate: (s: any) => { s.layoutRules = [s.layoutRules[0], { ...s.layoutRules[0] }]; }, code: "E_LAYOUT" },
      { id: "unordered-bounds", mutate: (s: any) => { s.layoutRules = [{ ...s.layoutRules[0], x_min: 5, x_max: -5 }]; }, code: "E_LAYOUT" }
    ];
    for (const m of mutations) {
      const doc = structuredClone(fixtures["quadratic-sweep"]);
      m.mutate(doc.scene);
      try {
        checkCartesianWindow(doc.scene);
        checks.push({ case: m.id, ok: false, expected: m.code, actual: null });
      } catch (e: any) {
        checks.push({ case: m.id, ok: e?.code === m.code, expected: m.code, actual: e?.code ?? null });
      }
    }
    gates.push({ gate: "G14_cartesian_window", status: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks });
  }

  // ---------- G14: fail-closed compile negatives ----------
  {
    const negatives = [
      { id: "wrong-symbolic-root", file: "quadratic-sweep", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "root_left").value = { kind: "symbolic", expr: { t: "app", "op": "+", args: [{ t: "sym", name: "a" }, { t: "num", v: { kind: "int", value: "2" } }] } }; }, code: "E_MATH_ASSERTION" },
      { id: "wrong-symbolic-extremum", file: "quadratic-sweep", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "vertex_x").value = { kind: "symbolic", expr: { t: "app", "op": "+", args: [{ t: "sym", name: "a" }, { t: "num", v: { kind: "int", value: "1" } }] } }; }, code: "E_MATH_ASSERTION" },
      { id: "wrong-derivative-at", file: "derivative-extrema", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "d_at2").value = { kind: "int", value: "8" }; }, code: "E_MATH_ASSERTION" },
      { id: "wrong-value-at", file: "derivative-extrema", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "v_at2").value = { kind: "int", value: "3" }; }, code: "E_MATH_ASSERTION" },
      { id: "wrong-intersection", file: "intersections", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "x_left").value = { kind: "int", value: "-2" }; }, code: "E_MATH_ASSERTION" },
      { id: "wrong-solution", file: "equation", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "sol_left").value = { kind: "int", value: "4" }; }, code: "E_MATH_ASSERTION" },
      { id: "noninteger-exponent-function", file: "derivative-extrema", mutate: (d: any) => { const e = d.math.entities.find((x: any) => x.id === "f"); e.props.expr = { t: "app", op: "^", args: [{ t: "sym", name: "x" }, { t: "sym", name: "x" }] }; }, code: "E_CAPABILITY_UNSUPPORTED" },
      { id: "undeclared-sweep-capability", file: "quadratic-sweep", mutate: (d: any) => { d.math.capabilities = d.math.capabilities.filter((c: string) => c !== "function2d.parameter_sweep"); }, code: "E_CAPABILITY_UNSUPPORTED" },
      { id: "unknown-claim-capability", file: "equation", mutate: (d: any) => { d.math.derived_facts.find((f: any) => f.fact_id === "sol_left").provenance.capability_id = "function2d.parameter_sweep"; }, code: "E_CAPABILITY_UNSUPPORTED" }
    ];
    const checks: any[] = [];
    for (const n of negatives) {
      const doc = structuredClone(fixtures[n.file]);
      n.mutate(doc);
      try {
        compileFunction(doc.math);
        checks.push({ case: n.id, ok: false, expected: n.code, actual: null });
      } catch (e: any) {
        checks.push({ case: n.id, ok: e?.code === n.code, expected: n.code, actual: e?.code ?? e?.message });
      }
    }
    checks.push({ case: "invalid-tan-contract-and-compile-pass", ok: invalidContracts.ok && invalidCompileOk, contract_codes: invalidContracts.emitted_error_codes, compile_ok: invalidCompileOk });
    gates.push({ gate: "G14_compile_negatives", status: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks });
  }

  // ---------- G14: semantic invariants ----------
  const anchorSets: Record<string, number[]> = {
    "quadratic-sweep": [0, 1, 3.5, 6, 8.5, 11, 2.13, 9.77], // a = -2..2 + random addressing
    "intersections": [1, 3, 5],
    "derivative-extrema": [1, 3, 5],
    "equation": [1, 3, 5]
  };
  const functionVectors: Record<string, any[]> = {};
  for (const name of files) {
    const rt = loadRuntime(fixtures[name], { domains });
    const program: VerifiedFunctionProgram = compileFunction(fixtures[name].math) as any;
    const checks: any[] = [];
    const vectors: any[] = [];
    for (const t of anchorSets[name]) {
      const state = rt.stateAt(t);
      // rebuild the domain snapshot with the SAME pipeline stateAt uses
      // (identical env + resolveBinding closure) and cross-check the digest
      const env = buildEnv(fixtures[name].math, state.modelTime);
      const snap = evaluateFunction(program, {
        modelTime: state.modelTime,
        env,
        resolveBinding: (source: string) => resolveSource(fixtures[name].math, source, env)
      });
      checks.push({ case: `snapshot_digest_matches_state@${t}`, ok: (state as any).domainDigest === snap.digest, state_domain_digest: (state as any).domainDigest, rebuilt: snap.digest });
      const snapAny: any = snap;
      // G14: parameter sweep == runtime binding (a(t) = -2+4t)
      if (name === "quadratic-sweep") {
        const expectedA = state.modelTime === null ? null : -2 + 4 * state.modelTime;
        const gotA = snapAny.entities?.f?.parameterValues?.a ?? null;
        const ok = expectedA === null ? gotA === null : Math.abs((gotA as number) - expectedA) <= 1e-12;
        checks.push({ case: `parameter_sweep@${t}`, ok, expected: expectedA, actual: gotA });
      }
      // G14: every sampled point equals an independent eval of f at x
      for (const fn of program.functions) {
        const curve: any = snapAny.entities?.[fn.id];
        if (!curve || !Array.isArray(curve.segments)) { checks.push({ case: `curve_present@${t}`, ok: false }); continue; }
        const pv: Record<string, number> = {};
        for (const [k, v] of Object.entries(curve.parameterValues ?? {})) pv[k] = v as number;
        const inactive = Object.values(curve.parameterValues ?? {}).some((v: any) => v === null);
        let sampleChecks = 0;
        let sampleFailures = 0;
        let firstSampleFailure: any = null;
        for (const seg of curve.segments) {
          // G14 checks EVERY sampled point against a fresh ExprAst evaluation.
          for (let idx = 0; idx < seg.length; idx++) {
            const pt = seg[idx];
            if (!pt) continue;
            sampleChecks++;
            let y: number | null = null;
            try {
              const env: any = {};
              for (const [k, v] of Object.entries(pv)) env[k] = { kind: "num", v };
              env[fn.variable] = { kind: "num", v: pt.x };
              const val = evalExpr(fn.expr, env);
              y = val.kind === "exact" ? ratToNumber(val.r as Rat) : val.v;
            } catch { y = null; }
            const ok = y !== null && Math.abs(y - pt.y) <= FUNCTION_EPS * (1 + Math.abs(pt.x));
            if (!ok) {
              sampleFailures++;
              if (firstSampleFailure === null) firstSampleFailure = { index: idx, x: pt.x, snapshot_y: pt.y, rechecked_y: y };
            }
          }
        }
        checks.push({ case: `all_samples_recheck@${t}:${fn.id}`, ok: sampleFailures === 0, points_checked: sampleChecks, failures: sampleFailures, first_failure: firstSampleFailure });
        if (!inactive && curve.segments.length === 0) checks.push({ case: `segments_nonempty@${t}`, ok: false });
      }
      // G5/G14: living claim predicates under CURRENT params
      const outcomes = assertFunctions(program, snap);
      for (const o of outcomes) {
        checks.push({ case: `assert@${t}:${o.assertion_id}`, ok: o.pass, detail: o.detail });
      }
      vectors.push({
        presentation_time: t,
        model_time: state.modelTime,
        state_digest: state.digest,
        curve_f: snapAny.entities?.f ? { parameterValues: snapAny.entities.f.parameterValues, segments: snapAny.entities.f.segments.length, sample_span: snapAny.entities.f.segments[0]?.length ?? 0 } : null,
        points: Object.fromEntries(program.derivedClaims.map((c) => [c.id, snapAny.facts?.[c.id]?.point ?? null]))
      });
    }
    functionVectors[name] = vectors;
    gates.push({ gate: `G14_invariants_${name}`, status: checks.length > 0 && checks.every((c) => c.ok) ? "PASS" : "FAIL", checks });
  }

  // ---------- G9: 100x determinism ----------
  {
    let ok = true;
    for (const name of files) {
      const rt = loadRuntime(fixtures[name], { domains });
      for (const t of anchorSets[name]) {
        const first = rt.stateAt(t).digest;
        for (let i = 0; i < 100; i++) if (rt.stateAt(t).digest !== first) ok = false;
      }
    }
    gates.push({ gate: "G9_function_determinism_100x", status: ok ? "PASS" : "FAIL", fixtures: files.length, anchors: Object.values(anchorSets).flat().length });
  }

  // ---------- sampling vectors artifact ----------
  const sweepProgram: VerifiedFunctionProgram = compileFunction(fixtures["quadratic-sweep"].math) as any;
  const samplingVectors: any = {
    frozen_policy: { sample_count: FUNCTION_SAMPLE_COUNT, eps: FUNCTION_EPS },
    sweeps: ([-2, 0, 2] as number[]).map((a) => {
      const fn = sweepProgram.functions[0];
      const sampled = sampleFunction(fn, { a }, FUNCTION_SAMPLE_COUNT);
      const seg = sampled.segments[0] ?? [];
      const spacingUniform = seg.length > 2 && seg.every((p, i) => i === 0 || Math.abs((p.x - seg[i - 1].x) - (seg[1].x - seg[0].x)) <= 1e-12);
      return {
        a,
        segments: sampled.segments.length,
        points: seg.length,
        first: seg[0] ?? null,
        middle: seg[Math.floor(seg.length / 2)] ?? null,
        last: seg[seg.length - 1] ?? null,
        spacing_uniform: spacingUniform,
        breaks: sampled.breakCount
      };
    }),
    invalid_tan: (() => {
      const prog: VerifiedFunctionProgram = compileFunction(invalidFixture.math) as any;
      const sampled = sampleFunction(prog.functions[0], {}, FUNCTION_SAMPLE_COUNT);
      return { segments: sampled.segments.length, points: (sampled.segments[0] ?? []).length, breaks: sampled.breakCount };
    })()
  };

  // ---------- G13: SymPy oracle (freeze-required) ----------
  const allowSympySkip = process.env.ALLOW_SYMPY_SKIP === "1";
  const g13: any = { gate: "G13_function_sympy_oracle", status: "PASS", sympy_version: null, pinned: PINNED_SYMPY_VERSION, rows: [] };
  let oracle: SympyOracle | null = null;
  let sympyClient: SympyClient | null = null;
  if (process.env.MATHVIZ_TEST_NO_SYMPY === "1") {
    g13.status = allowSympySkip ? "SKIP" : "INCOMPLETE";
    g13.note = "test override: sympy oracle disabled; run remains INCOMPLETE";
  } else {
    try {
      const client = await SympyClient.connect();
      sympyClient = client;
      activeSympyClient = client;
      oracle = new SympyOracle(client);
      g13.sympy_version = oracle.version;
      sympyOracleLog.sympy_version = oracle.version;
    } catch (e: any) {
      g13.status = allowSympySkip ? "SKIP" : "INCOMPLETE";
      g13.note = `oracle unavailable; run remains INCOMPLETE: ${e?.message ?? e}`;
    }
  }
  if (oracle) {
    const rows: any[] = g13.rows;
    const row = (fixture: string, check: string, ok: boolean, detail: any) => {
      rows.push({ fixture, check, ok, detail });
      if (!ok) g13.status = "FAIL";
    };
    const paramEnvFor = (prog: VerifiedFunctionProgram): Record<string, number> => {
      // canonical comparison env: each parameter at its max (deterministic)
      const env: Record<string, number> = {};
      for (const [k, r] of Object.entries(prog.parameterRanges)) env[k] = r.max;
      return env;
    };
    const compareSets = async (fixture: string, check: string, oracleValues: any[], frozenValues: any[], env: Record<string, number>) => {
      const cmp = (a: any, b: any) => {
        const ka = valueKey(a, env), kb = valueKey(b, env);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      };
      const o = [...oracleValues].sort(cmp);
      const f = [...frozenValues].sort(cmp);
      if (o.length !== f.length) { row(fixture, check, false, { oracle_count: o.length, frozen_count: f.length }); return; }
      let ok = true;
      const pairs: any[] = [];
      for (let i = 0; i < o.length; i++) {
        const ra = exactRatio(o[i]), rb = exactRatio(f[i]);
        let eq: boolean;
        if (ra && rb) eq = ra[0] * rb[1] === rb[0] * ra[1];
        else if (!ra && !rb) eq = await oracle!.checkEqual(o[i].expr, f[i].expr);
        else eq = false;
        pairs.push({ oracle: o[i], frozen: f[i], equal: eq });
        if (!eq) ok = false;
      }
      row(fixture, check, ok, pairs);
    };

    for (const name of files) {
      const prog: VerifiedFunctionProgram = compileFunction(fixtures[name].math) as any;
      const env = paramEnvFor(prog);
      // (a) TS symbolic differentiation vs SymPy diff — independent tracks
      for (const fn of prog.functions) {
        const tsDiff = differentiate(fn.expr, fn.variable);
        const oracleDiff = await oracle.derivative(fn.expr, fn.variable);
        const rhs = oracleDiff.kind === "symbolic" ? oracleDiff.expr : { t: "num", v: oracleDiff };
        const eq = await oracle.checkEqual(tsDiff, rhs);
        row(name, `derivative_expression:${fn.id}`, eq, { ts: tsDiff, sympy: oracleDiff });
      }
      // (b) per-capability frozen claims vs oracle re-derivation
      const groups = new Map<string, any[]>();
      for (const c of prog.derivedClaims) {
        const key = `${c.capabilityId}|${c.functionIds.join(",")}|${c.equationId ?? ""}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
      }
      for (const [key, claims] of groups) {
        const cap = claims[0].capabilityId;
        try {
          if (cap === "function2d.roots") {
            const fn = prog.functions.find((f) => f.id === claims[0].functionIds[0])!;
            const res = await oracle.roots(fn.expr, fn.variable);
            await compareSets(name, `roots:${fn.id}`, res.values, claims.map((c) => c.value), env);
          } else if (cap === "function2d.intersection") {
            const [fa, fb] = claims[0].functionIds.map((id) => prog.functions.find((f) => f.id === id)!) as any[];
            const res = await oracle.intersection(fa.expr, fb.expr, fa.variable);
            await compareSets(name, `intersection:${fa.id},${fb.id}`, res.values, claims.map((c) => c.value), env);
          } else if (cap === "function2d.extremum") {
            const fn = prog.functions.find((f) => f.id === claims[0].functionIds[0])!;
            const res = await oracle.extremum(fn.expr, fn.variable);
            await compareSets(name, `extremum_x:${fn.id}`, res.points.map((p) => p.x), claims.map((c) => c.value), env);
            // extremum y: oracle exact vs TS numeric eval (mixed cross-check)
            let yOk = res.points.length === claims.length;
            const yDetail: any[] = [];
            for (const p of res.points) {
              const xNum = numericOf(p.x, env) ?? 0;
              const env2: any = {};
              for (const [k, n] of Object.entries(env)) env2[k] = { kind: "num", v: n };
              env2[fn.variable] = { kind: "num", v: xNum };
              const val = evalExpr(fn.expr, env2);
              const yTs = val.kind === "exact" ? ratToNumber(val.r as Rat) : val.v;
              const yOracle = numericOf(p.y, env);
              const ok = yOracle !== null && Math.abs(yTs - yOracle) <= FUNCTION_EPS * (1 + Math.abs(xNum));
              yDetail.push({ x: p.x, oracle_y: p.y, ts_y: yTs, type: p.type, ok });
              if (!ok) yOk = false;
            }
            row(name, `extremum_y:${fn.id}`, yOk, yDetail);
            // Independently classify min/max from the TS second derivative,
            // then compare with SymPy's exact curvature classification.
            const d1 = differentiate(fn.expr, fn.variable);
            const d2 = differentiate(d1, fn.variable);
            const classDetail: any[] = [];
            let classOk = true;
            for (const p of res.points) {
              const xNum = numericOf(p.x, env);
              if (xNum === null) { classOk = false; classDetail.push({ x: p.x, ok: false, reason: "non-numeric sample" }); continue; }
              const env2: any = {};
              for (const [k, n] of Object.entries(env)) env2[k] = { kind: "num", v: n };
              env2[fn.variable] = { kind: "num", v: xNum };
              const cv0 = evalExpr(d2, env2);
              const cv = cv0.kind === "exact" ? ratToNumber(cv0.r as Rat) : cv0.v;
              // P4.1: no "flat" verdict — an inconclusive second derivative
              // must have been REFUSED by SymPy; a returned point here is a
              // cross-check failure, never a classification.
              const expected = cv > FUNCTION_EPS ? "min" : cv < -FUNCTION_EPS ? "max" : null;
              const ok = expected !== null && p.type === expected;
              classDetail.push({ x: p.x, second_derivative: cv, sympy_type: p.type, ts_type: expected ?? "undetermined", ok });
              if (!ok) classOk = false;
            }
            row(name, `extremum_classification:${fn.id}`, classOk, classDetail);
          } else if (cap === "function2d.derivative_at") {
            for (const c of claims) {
              const fn = prog.functions.find((f) => f.id === c.functionIds[0])!;
              const derivVal = await oracle.derivative(fn.expr, fn.variable);
              const derivExpr = derivVal.kind === "symbolic" ? derivVal.expr : { t: "num", v: derivVal };
              const at = { kind: "rational", p: c.at!.p, q: c.at!.q };
              const oracleVal = await oracle.valueAt(derivExpr, fn.variable, at);
              const ra = exactRatio(oracleVal), rb = exactRatio(c.value);
              const ok = !!ra && !!rb && ra[0] * rb[1] === rb[0] * ra[1];
              row(name, `derivative_at:${c.id}`, ok, { at, oracle: oracleVal, frozen: c.value });
            }
          } else if (cap === "function2d.value_at") {
            for (const c of claims) {
              const fn = prog.functions.find((f) => f.id === c.functionIds[0])!;
              const at = { kind: "rational", p: c.at!.p, q: c.at!.q };
              const oracleVal = await oracle.valueAt(fn.expr, fn.variable, at);
              const ra = exactRatio(oracleVal), rb = exactRatio(c.value);
              const ok = !!ra && !!rb && ra[0] * rb[1] === rb[0] * ra[1];
              row(name, `value_at:${c.id}`, ok, { at, oracle: oracleVal, frozen: c.value });
            }
          } else if (cap === "function2d.solve_equation") {
            const eq = prog.equations.find((q) => q.id === claims[0].equationId)!;
            const res = await oracle.solveEquation(eq.lhs, eq.rhs, eq.variable);
            await compareSets(name, `solve_equation:${eq.id}`, res.values, claims.map((c) => c.value), env);
          }
        } catch (e: any) {
          row(name, key, false, { error: e?.message ?? String(e) });
        }
      }
    }
    // (c) negatives: fail-closed refusals must stay refusals (P4.1)
    try {
      const eq = invalidFixture.math.entities.find((e: any) => e.id === "eq_tan");
      await oracle.solveEquation(eq.props.lhs, eq.props.rhs, "x");
      row("invalid-function", "nonfinite_solution_set_refused", false, { error: "oracle unexpectedly returned a finite set" });
    } catch (e: any) {
      row("invalid-function", "nonfinite_solution_set_refused", e?.code === "E_CAPABILITY_UNSUPPORTED", { code: e?.code, message: e?.message });
    }
    // ConditionSet (x^2+a=0 over Reals, free parameter a): no solve() fallback
    try {
      await oracle.solveEquation(
        { t: "app", op: "+", args: [{ t: "app", op: "^", args: [{ t: "sym", name: "x" }, { t: "num", v: { kind: "int", value: "2" } }] }, { t: "sym", name: "a" }] },
        { t: "num", v: { kind: "int", value: "0" } },
        "x"
      );
      row("negative", "conditionset_refused", false, { error: "oracle unexpectedly solved a conditional/parametric set" });
    } catch (e: any) {
      row("negative", "conditionset_refused", e?.code === "E_CAPABILITY_UNSUPPORTED", { code: e?.code, message: e?.message });
    }
    // f(x)=x^3: f'(0)=0 with f''(0)=0 — NOT classifiable; must be refused
    try {
      const cube = { t: "app", op: "^", args: [{ t: "sym", name: "x" }, { t: "num", v: { kind: "int", value: "3" } }] };
      await oracle.extremum(cube as any, "x");
      row("negative", "inconclusive_extremum_refused", false, { error: "oracle unexpectedly classified f''=0 stationary point" });
    } catch (e: any) {
      row("negative", "inconclusive_extremum_refused", e?.code === "E_CAPABILITY_UNSUPPORTED", { code: e?.code, message: e?.message });
    }
    sympyOracleLog.rows = rows;
  }
  sympyClient?.kill();
  activeSympyClient = null;
  gates.push(g13);

  // ---------- G10: node vs chrome ----------
  const sweepRt = loadRuntime(fixtures["quadratic-sweep"], { domains });
  const sweepFrames = [0, 24, 48, 72, 96, 120, 144, 168, 192, 216, 240, 264];
  let g10: any = { gate: "G10_cross_output_consistency", browser: "NOT FOUND", frames: [], status: "PASS" };
  const chrome = findChrome();
  const allowBrowserSkip = process.env.ALLOW_BROWSER_SKIP === "1";
  g10.browser = chrome ?? "NOT FOUND";
  if (!chrome) {
    g10.status = allowBrowserSkip ? "SKIP" : "INCOMPLETE";
    g10.note = allowBrowserSkip ? "development-only G10 skip explicitly allowed; this run is INCOMPLETE" : "Chrome not found; required G10 was not executed";
  } else {
    for (const frame of sweepFrames) {
      const node = sweepRt.stateAtFrame(frame);
      const br = browserDigest(chrome, frame);
      const ok = br.digest === node.digest && br.domainDigest === String(node.domainDigest ?? "null") && br.rendered === String(frame);
      g10.frames.push({ frame, node_digest: node.digest, browser_digest: br.digest, node_domain_digest: node.domainDigest, browser_domain_digest: br.domainDigest, rendered: br.rendered, ok });
      if (!ok) g10.status = "FAIL";
    }
  }
  gates.push(g10);

  // ---------- artifacts ----------
  const svg = renderSvg(sweepRt.stateAt(6), fixtures["quadratic-sweep"].scene);
  const invariants = {
    no_previous_frame_accumulation: true,
    no_llm: true,
    no_browser_sympy: true,
    renderer_math: false,
    runtime_domain_branch: false,
    compile_once_digest: sweepProgram.digest,
    sampling_policy: { sample_count: FUNCTION_SAMPLE_COUNT, eps: FUNCTION_EPS }
  };
  const artifacts = path.join(ROOT, "runs", "p4");
  fs.mkdirSync(artifacts, { recursive: true });
  const summary = summarizeGates(gates, allowBrowserSkip, { allowSympySkip });
  fs.writeFileSync(path.join(artifacts, "gates.json"), canonicalSerialize({ fixtures: files, results: gates, summary: summary.summary }) + "\n", "utf8");
  fs.writeFileSync(path.join(artifacts, "function-vectors.json"), canonicalSerialize({ vectors: functionVectors, invariants, svg_sha256: require("node:crypto").createHash("sha256").update(svg).digest("hex") }) + "\n", "utf8");
  fs.writeFileSync(path.join(artifacts, "sampling-vectors.json"), canonicalSerialize(samplingVectors) + "\n", "utf8");
  fs.writeFileSync(path.join(artifacts, "sympy-oracle.json"), canonicalSerialize(sympyOracleLog) + "\n", "utf8");
  console.log(`P4 report: ${artifacts}`);
  console.log(`P4 GATES: ${summary.summary}`);
  process.exitCode = summary.exitCode;
}

main().catch((err) => { activeSympyClient?.kill(); activeSympyClient = null; console.error(err); process.exitCode = 1; });
