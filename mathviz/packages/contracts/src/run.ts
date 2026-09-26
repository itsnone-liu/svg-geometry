import fs from "node:fs";
import path from "node:path";
import { loadCases } from "./load";
import { runCase } from "./gates";
import { canonicalSerialize, canonicalDigest } from "./serialize";

function main(): number {
  const cases = loadCases();
  const results = cases.map(c => {
    const r = runCase(c);
    r.digest = canonicalDigest(c.doc);
    return r;
  });

  const valid = results.filter(r => r.expect === "pass");
  const invalid = results.filter(r => r.expect === "fail");
  const report = {
    schemaVersion: "mathviz.p0-report/v1",
    totals: {
      cases: results.length,
      valid: valid.length,
      invalid: invalid.length,
      valid_all_pass: valid.every(r => r.ok),
      invalid_all_fail_expected: invalid.every(r => r.ok),
      all_ok: results.every(r => r.ok)
    },
    gate_summary: summarizeGates(results),
    cases: results
  };

  const runsDir = path.join(process.cwd(), "runs", "p0");
  fs.mkdirSync(runsDir, { recursive: true });
  const reportPath = path.join(runsDir, "report.json");
  fs.writeFileSync(reportPath, canonicalSerialize(report) + "\n", "utf8");

  const line = (r: (typeof results)[number]) =>
    `${r.ok ? "OK " : "BAD"}  ${r.expect === "pass" ? "PASS-EXP" : "FAIL-EXP"}  ${r.case_id.padEnd(34)} ${r.kind.padEnd(9)} emitted=[${r.emitted_error_codes.join(",")}]`;

  console.log("== MathViz P0 gate harness ==");
  for (const r of results) console.log(line(r));
  console.log("--");
  console.log(`valid fixtures:   ${valid.length}  all pass: ${report.totals.valid_all_pass}`);
  console.log(`invalid fixtures: ${invalid.length}  all fail on expected codes: ${report.totals.invalid_all_fail_expected}`);
  console.log(`report: ${reportPath}`);
  console.log(report.totals.all_ok ? "P0 GATES: ALL GREEN" : "P0 GATES: FAILURES PRESENT");
  return report.totals.all_ok ? 0 : 1;
}

function summarizeGates(results: ReturnType<typeof runCase>[]) {
  const summary: Record<string, { pass: number; fail: number; skip: number }> = {};
  for (const r of results) {
    for (const g of r.gates) {
      const s = (summary[g.gate] ??= { pass: 0, fail: 0, skip: 0 });
      s[g.status.toLowerCase() as "pass" | "fail" | "skip"]++;
    }
  }
  return summary;
}

process.exit(main());
