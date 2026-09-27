// P5.0 gate runner: ProblemSpec v1 contract + deterministic compile proof.
//
// G15_spec_contract      — valid handwritten specs pass schema + semantic
//                          validation; the frozen negative set (answer-bearing
//                          goals, smuggled answer layers, unknown/cross-domain/
//                          presentation capabilities, dangling inputs, empty
//                          goals, bad spans) fails with the expected codes.
// G16_spec_deterministic — for each of the three domains:
//   (a) compile is deterministic (two runs -> byte-identical canonical JSON)
//   (b) the emitted Math IR passes the frozen gates G1/G2/G3 (schema,
//       provenance, capability) — answers now carry full derived provenance
//   (c) the emitted Math IR compiles with the EXISTING domain adapter into a
//       Verified Domain Program (digest present)
//   (d) every goal answer matches an INDEPENDENT numeric recomputation from
//       the source semantics (double-entry: solver vs hand formula)
// Artifacts: runs/p50/{gates.json, report.md, compiled/*.math.json}

import fs from "node:fs";
import path from "node:path";
import { ROOT, validatorFor } from "../../contracts/src/load";
import { validateProblemSpec } from "../../contracts/src/spec-validate";
import { gateSchema, gateProvenance, gateCapability, type VizError } from "../../contracts/src/gates";
import { canonicalSerialize } from "../../contracts/src/serialize";
import { compileProblemSpec } from "./compile";
import { compileFunction } from "../../domains/function2d/src/compile";
import { compileMotion } from "../../domains/motion1d/src/compile";
import { compileGeometry } from "../../domains/geometry2d/src/compile";
import { ratToNumber } from "../../runtime/src/expr/exact";
import type { Rat } from "../../runtime/src/expr/exact";

const SPEC_DIR = path.join(ROOT, "fixtures", "spec");
const OUT_DIR = path.join(ROOT, "runs", "p50");

function loadJson(rel: string): any {
  return JSON.parse(fs.readFileSync(rel, "utf8"));
}

const codes = (errs: VizError[]) => errs.map((e) => e.code);

/** Independent numeric oracle per fixture — a hand formula over the SOURCE
 * semantics, deliberately NOT the spec compiler's code path. */
interface FixtureOracle {
  file: string;
  /** numeric answers keyed by fact_id; event checks keyed by "event:<id>". */
  expected: Record<string, number>;
  verify: (compiled: { math: any; goalResults: any[] }, expected: Record<string, number>) => string[];
}

const oracles: FixtureOracle[] = [
  {
    file: "function2d-solve.spec.json",
    expected: { solve_main_sol_1: 2, solve_main_sol_2: 3 },
    verify: (compiled) => {
      const errs: string[] = [];
      for (const [factId, want] of Object.entries({ solve_main_sol_1: 2, solve_main_sol_2: 3 })) {
        const f = compiled.math.derived_facts.find((x: any) => x.fact_id === factId);
        if (!f) { errs.push(`missing derived fact ${factId}`); continue; }
        const v = f.value.kind === "int" ? Number(f.value.value) : Number(f.value.p) / Number(f.value.q);
        if (v !== want) errs.push(`${factId}: got ${v}, want ${want}`);
      }
      return errs;
    }
  },
  {
    file: "motion1d-meeting.spec.json",
    expected: { "event:meet": 10, meet_time: 10, meet_pos: 50 },
    verify: (compiled) => {
      const errs: string[] = [];
      const program = compileMotion(compiled.math);
      const ev = program.events.find((e: any) => e.eventId === "meet");
      if (!ev) return ["motion program has no solved 'meet' event"];
      // independent: xA(t) = 0 + 5t, xB(t) = 100 - 5t; equal at t = 10, x = 50
      const t = ratToNumber({ p: BigInt(ev.time.p), q: BigInt(ev.time.q) } as Rat);
      const x = ratToNumber({ p: BigInt(ev.position.p), q: BigInt(ev.position.q) } as Rat);
      const tIndep = (100 - 0) / (5 - -5);
      if (Math.abs(t - tIndep) > 1e-9) errs.push(`meet time: solver ${t} vs independent ${tIndep}`);
      if (Math.abs(x - (0 + 5 * tIndep)) > 1e-9) errs.push(`meet position: solver ${x} vs independent ${0 + 5 * tIndep}`);
      return errs;
    }
  },
  {
    file: "geometry2d-length.spec.json",
    expected: { len_length: 10 },
    verify: (compiled) => {
      const errs: string[] = [];
      const f = compiled.math.derived_facts.find((x: any) => x.fact_id === "len_length");
      if (!f) return ["missing derived fact len_length"];
      const v = f.value.kind === "int" ? Number(f.value.value) : f.value.kind === "rational" ? Number(f.value.p) / Number(f.value.q) : NaN;
      const indep = Math.hypot(6 - 0, 8 - 0);
      if (Math.abs(v - indep) > 1e-9) errs.push(`len_length: solver ${v} vs independent ${indep}`);
      return errs;
    }
  }
];

function main(): void {
  fs.mkdirSync(path.join(OUT_DIR, "compiled"), { recursive: true });
  const gates: any[] = [];
  const report: string[] = ["# P5.0 gate artifacts (generated)", ""];

  // ---------- G15 ----------
  {
    const rows: any[] = [];
    for (const oracle of oracles) {
      const doc = loadJson(path.join(SPEC_DIR, oracle.file));
      const schemaErrs = gateSchema(doc, "problemspec");
      const semErrs = validateProblemSpec(doc);
      rows.push({
        case: oracle.file,
        ok: schemaErrs.length === 0 && semErrs.length === 0,
        schema_errors: codes(schemaErrs),
        semantic_errors: codes(semErrs)
      });
    }
    const invalid = loadJson(path.join(SPEC_DIR, "cases.invalid.json"));
    for (const c of invalid.cases) {
      const schemaErrs = gateSchema(c.doc, "problemspec");
      const semErrs = validateProblemSpec(c.doc);
      const got = new Set([...codes(schemaErrs), ...codes(semErrs)]);
      const ok = c.expected_error_codes.every((code: string) => got.has(code));
      rows.push({ case: c.case_id, ok, expected: c.expected_error_codes, got: [...got] });
    }
    const ok = rows.every((r) => r.ok);
    gates.push({ gate: "G15_spec_contract", status: ok ? "PASS" : "FAIL", rows });
    report.push(`## G15_spec_contract: ${ok ? "PASS" : "FAIL"}`);
    for (const r of rows) report.push(`- ${r.ok ? "ok" : "FAIL"} ${r.case}${r.ok ? "" : " " + JSON.stringify(r)}`);
    report.push("");
  }

  // ---------- G16 ----------
  {
    const rows: any[] = [];
    for (const oracle of oracles) {
      const spec = loadJson(path.join(SPEC_DIR, oracle.file));
      const row: any = { case: oracle.file, checks: {} };
      const set = (name: string, ok: boolean, detail?: unknown) => {
        row.checks[name] = ok;
        if (!ok) row[name + "_detail"] = detail;
      };
      try {
        // (a) determinism
        const c1 = compileProblemSpec(spec);
        const c2 = compileProblemSpec(spec);
        set("deterministic_compile", canonicalSerialize(c1.math) === canonicalSerialize(c2.math));

        // (b) emitted Math IR passes the frozen gates
        const schemaErrs = gateSchema(c1.math, "math");
        const provErrs = gateProvenance(c1.math);
        const capErrs = gateCapability(c1.math);
        set("math_gate_schema", schemaErrs.length === 0, schemaErrs);
        set("math_gate_provenance", provErrs.length === 0, provErrs);
        set("math_gate_capability", capErrs.length === 0, capErrs);

        // (c) compiles with the EXISTING domain adapter
        try {
          if (spec.domain === "function2d") {
            const p = compileFunction(c1.math);
            set("domain_program_compiles", p.derivedClaims.length === c1.goalResults.reduce((n, g) => n + g.factIds.length, 0));
          } else if (spec.domain === "motion1d") {
            const p = compileMotion(c1.math);
            set("domain_program_compiles", p.events.length === c1.goalResults.reduce((n, g) => n + g.eventIds.length, 0));
          } else {
            const p = compileGeometry(c1.math);
            set("domain_program_compiles", typeof p.digest === "string" && /^[0-9a-f]{64}$/.test(p.digest));
          }
        } catch (e: any) {
          set("domain_program_compiles", false, e?.message);
        }

        // (d) independent numeric double-entry
        try {
          const errs = oracle.verify(c1, oracle.expected);
          set("independent_numeric_agreement", errs.length === 0, errs);
        } catch (e: any) {
          set("independent_numeric_agreement", false, e?.message);
        }

        fs.writeFileSync(
          path.join(OUT_DIR, "compiled", oracle.file.replace(".spec.json", ".math.json")),
          JSON.stringify({ problemSpec: spec, compiled: c1 }, null, 2) + "\n",
          "utf8"
        );
      } catch (e: any) {
        set("compile", false, `${e?.code ?? ""}: ${e?.message}`);
      }
      row.ok = Object.values(row.checks).every(Boolean);
      rows.push(row);
    }
    const ok = rows.every((r) => r.ok);
    gates.push({ gate: "G16_spec_deterministic_compile", status: ok ? "PASS" : "FAIL", rows });
    report.push(`## G16_spec_deterministic_compile: ${ok ? "PASS" : "FAIL"}`);
    for (const r of rows) {
      report.push(`- ${r.ok ? "ok" : "FAIL"} ${r.case}: ${Object.entries(r.checks).map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" ")}`);
      for (const [k, v] of Object.entries(r.checks)) if (!v) report.push(`  - ${k}: ${JSON.stringify(r[k + "_detail"])}`);
    }
    report.push("");
  }

  const summary = gates.every((g) => g.status === "PASS") ? "ALL GREEN" : "FAILURES PRESENT";
  fs.writeFileSync(path.join(OUT_DIR, "gates.json"), JSON.stringify({ summary, results: gates }, null, 2) + "\n", "utf8");
  report.push(`## Summary: ${summary}`, "");
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), report.join("\n"), "utf8");
  console.log(`P5.0 report: ${OUT_DIR}`);
  console.log(`P50 GATES: ${summary}`);
  if (summary !== "ALL GREEN") process.exit(1);
}

main();
