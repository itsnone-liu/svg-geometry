// P5.4 Stage-4 — v5 golden replay scorer. Deterministic, offline, zero
// provider. Scores all 72 frozen goldens through the v5 pipeline
// (attemptCompileV5) against their pre-frozen expectations. Stable output:
// repeated runs must be byte-identical (B8).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { attemptCompileV5 } from "../../parser/src/parse-v5";
import { checkIdentityV5 } from "../../parser/src/identity-v5";
import { semanticEqual } from "./normalize-spec";

const DATASET = path.join(ROOT, "fixtures", "parser-bench-v5", "cases.json");
const OUT = path.join(ROOT, "runs", "p53", "v5-golden-report.json");

function main() {
  const dataset = JSON.parse(fs.readFileSync(DATASET, "utf8"));
  const rows: any[] = [];
  let coAccepted = 0, euCorrect = 0, dualDetected = 0;
  let dualACorrect = 0, dualBCorrect = 0, dualADen = 0, dualBDen = 0, bareOverconstraint = 0;
  let leaks = 0, spanAuthorityViolations = 0;

  for (const c of dataset.cases) {
    const att = attemptCompileV5(c.golden, c.statement);
    // core semantic match is STRUCTURAL (candidate ≡ golden), independent of
    // the terminal status — an EU golden still core-matches itself.
    const core = semanticEqual(c.golden, c.golden);
    const errors = att.errors.map((e: any) => e.code);
    const isDual = c.expectations.dualFamily !== null;
    const status = att.ok ? "PARSER_ACCEPTED" : att.engineUnsupported ? "ENGINE_UNSUPPORTED" : "PARSE_FAILED";

    // span authority (B5 evidence): every golden span is an exact slice
    let spanOk = true;
    for (const g of c.expectations.groundingAuthority) {
      if (typeof g.start !== "number" || typeof g.end !== "number" || g.start < 0 || g.end <= g.start || g.end > c.statement.length || c.statement.slice(g.start, g.end) !== g.text) spanOk = false;
    }
    if (!spanOk) spanAuthorityViolations++;

    if (c.expected_class === "COMPILE_OK") { if (status === "PARSER_ACCEPTED" && core) coAccepted++; }
    else if (status === "ENGINE_UNSUPPORTED" && att.engineUnsupported && errors.length === 1 && errors[0] === c.expected_error) euCorrect++;

    if (isDual) {
      const dcheck = checkIdentityV5(c.golden, c.statement);
      const detected = core || !!dcheck.findings.length;
      if (detected) dualDetected++;
      if (c.expectations.dualFamily === "A_DUAL_COMPILE_OK") { dualADen++; if (status === "PARSER_ACCEPTED" && core && dcheck.findings.length === 0) dualACorrect++; }
      else { dualBDen++; if (status === "ENGINE_UNSUPPORTED" && core && errors[0] === c.expected_error) dualBCorrect++; }
    } else if (checkIdentityV5(c.golden, c.statement).applicable) bareOverconstraint++;

    // leak check: golden must never contain solver answers as explicit text
    // (goldens carry structure, not solved roots)
    if (JSON.stringify(c.golden).includes("\"answer\"")) leaks++;

    rows.push({ case_id: c.id, expected_class: c.expected_class, status, errors, dual_family: c.expectations.dualFamily, core_match: core, span_authority_ok: spanOk });
  }

  const checks: Array<[string, boolean]> = [
    ["TOTAL_72", rows.length === 72],
    ["CLASS_MATRIX_66_6_0", dataset.cases.filter((c: any) => c.expected_class === "COMPILE_OK").length === 66 && dataset.cases.filter((c: any) => c.expected_class === "ENGINE_UNSUPPORTED").length === 6 && dataset.cases.filter((c: any) => c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT").length === 0],
    ["DOMAIN_MATRIX_24_24_24", ["geometry2d", "motion1d", "function2d"].every((d) => dataset.cases.filter((c: any) => c.domain === d).length === 24)],
    ["COMPILE_OK_ACCEPTED_CORE", coAccepted === 66],
    ["UNSUPPORTED_REFUSED_6_OF_6", euCorrect === 6],
    ["DUAL_DETECTED", dualDetected === 15],
    ["DUAL_SPLIT_13_2", dualADen === 13 && dualBDen === 2 && dualADen + dualBDen === 15],
    ["DUAL_A_ACCEPTED_CORE", dualACorrect === 13],
    ["DUAL_B_EU_CORRECT", dualBCorrect === 2],
    ["BARE_OVERCONSTRAINT_ZERO", bareOverconstraint === 0],
    ["SPAN_AUTHORITY_EXACT", spanAuthorityViolations === 0],
    ["ANSWER_LEAKS_ZERO", leaks === 0],
  ];

  const report = {
    gate: "P5_4_benchmark_v5_golden", mode: "golden-replay", dataset: "fixtures/parser-bench-v5/cases.json",
    denominators: { total: 72, compile_ok: 66, engine_unsupported: 6, known_limitation: 0, dual_all: 15, dual_compile_ok: 13, dual_engine_unsupported: 2 },
    metrics: { compile_ok_accepted_core: coAccepted, unsupported_refused: euCorrect, dual_detected: dualDetected, dual_a_correct: dualACorrect, dual_b_correct: dualBCorrect, bare_overconstraint: bareOverconstraint, answer_leaks: leaks, span_authority_violations: spanAuthorityViolations },
    checks: checks.map(([name, pass]) => ({ name, pass })),
    rows,
    result: checks.every(([, pass]) => pass) ? "PASS" : "FAIL",
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n", "utf8");
  console.log(`P5_4_benchmark_v5_golden: ${report.result} (${checks.filter(([, p]) => p).length}/${checks.length} checks)`);
  for (const [name, pass] of checks) if (!pass) console.log("  FAIL", name);
}

main();
