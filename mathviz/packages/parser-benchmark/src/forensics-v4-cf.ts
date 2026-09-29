// P5.4 Stage-1.1 COUNTERFACTUAL CAUSALITY AUDIT (owner-authorized erratum
// follow-up). ZERO provider requests. For each of the 10 repair-regression
// cases, deterministically replay attemptCompileV4 over four variants of the
// recorded A1 parsed_candidate:
//   CF0 = A1 verbatim (control)
//   CF1 = A1 + ONLY the golden function.label added (every other byte equal)
//   CF2 = A1 + ONLY the equation provenance.span replaced by golden's span
//   CF3 = A1 + both changes
// Decision rule (pre-registered by the owner; results not pre-registered):
//   CF1 clears 10/10 -> primary cause = function-identity (label) omission
//   CF2 clears alone -> Stage-1 original span conclusion stands
//   only CF3 clears -> two-factor causality
//   neither clears  -> third factor remains to be found
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { attemptCompileV4 } from "../../parser/src/parse-v4";
import { semanticEqual } from "./normalize-spec";
import { groundProblemSpec } from "./grounding";
import { checkSourceFidelity } from "../../parser/src/fidelity";
import { functionZeroErrors } from "../../parser/src/function-zero-duality";
import { readGitBlob } from "./git-blob";
import { V4_DATASET_PATH } from "./freeze-v4";

const EV = path.join(ROOT, "fixtures", "parser-bench-v4", "live-evidence");
const OUT = path.join(ROOT, "runs", "p53", "v4-forensics-cf.json");
const FREEZE = "877bf6dd0ee30d4adca62d79cded0eaf657edf64";
const REG = ["v4_f_01", "v4_f_02", "v4_f_04", "v4_f_05", "v4_f_08", "v4_f_10", "v4_f_12", "v4_f_13", "v4_f_14", "v4_f_15"];

const clone = (x: any) => JSON.parse(JSON.stringify(x));

function probe(candidate: any, statement: string) {
  const att = attemptCompileV4(candidate, statement);
  const g19 = groundProblemSpec(candidate, statement);
  const fid = checkSourceFidelity(candidate, statement);
  const fz = functionZeroErrors(candidate, statement);
  return {
    ok: att.ok, engineUnsupported: att.engineUnsupported,
    compileError: att.compileError?.code ?? null,
    errors: att.errors.map((e: any) => e.code),
    counts: { total: att.errors.length, fidelity: fid.findings.length, function_zero: fz.length, grounding_ungrounded: g19.semanticTotal - g19.semanticGroundedCount },
    fidelity_codes: fid.findings.map((f: any) => f.code),
    function_zero_codes: fz.map((e: any) => e.code),
    grounding_ungrounded: g19.findings.filter((f: any) => f.grounded === false).map((f: any) => ({ path: f.path, reason: f.reason })),
  };
}

function main() {
  const dataset = JSON.parse(readGitBlob(FREEZE, V4_DATASET_PATH).toString("utf8"));
  const diag = JSON.parse(fs.readFileSync(path.join(EV, "benchmark-v4-diagnostics.json"), "utf8"));
  const rows: any[] = [];
  let cf1Clear = 0, cf2Clear = 0, cf3Clear = 0, cf1Better = 0, cf2Better = 0, noneSufficient: string[] = [];

  for (const id of REG) {
    const c = dataset.cases.find((x: any) => x.id === id);
    const a1 = diag.find((x: any) => x.case_id === id).diagnostics.find((x: any) => x.stage === "A1").parsed_candidate;
    const gfn = c.golden.entities.find((e: any) => e.kind === "function");
    const gefn = c.golden.entities.find((e: any) => e.kind === "equation");

    const cf0 = clone(a1);
    const cf1 = clone(a1); cf1.entities.find((e: any) => e.kind === "function").label = gfn.label;
    const cf2 = clone(a1); cf2.entities.find((e: any) => e.kind === "equation").provenance.span = clone(gefn.provenance.span);
    const cf3 = clone(a1); { const f = cf3.entities.find((e: any) => e.kind === "function"); f.label = gfn.label; cf3.entities.find((e: any) => e.kind === "equation").provenance.span = clone(gefn.provenance.span); }

    const r: any = { case_id: id, expected_class: c.expected_class, golden_fn_label: gfn.label, a1_fn_label: a1.entities.find((e: any) => e.kind === "function").label ?? null };
    for (const [name, cf] of [["CF0", cf0], ["CF1", cf1], ["CF2", cf2], ["CF3", cf3]] as const) {
      r[name] = probe(cf, c.statement);
      r[name].core_equivalent = semanticEqual(cf, c.golden);
    }
    if (r.CF1.ok) cf1Clear++; if (r.CF2.ok) cf2Clear++; if (r.CF3.ok) cf3Clear++;
    if (r.CF1.counts.total < r.CF0.counts.total) cf1Better++;
    if (r.CF2.counts.total < r.CF0.counts.total) cf2Better++;
    if (!r.CF1.ok && !r.CF2.ok && !r.CF3.ok) noneSufficient.push(id);
    rows.push(r);
  }

  let verdict: string;
  if (cf1Clear === REG.length) verdict = "CF1 clears 10/10: PRIMARY CAUSE = function-identity (label) omission; span normalization is NOT the primary repair";
  else if (cf2Clear === REG.length && cf1Clear < REG.length) verdict = "CF2 clears alone: Stage-1 original equation-span conclusion stands";
  else if (cf3Clear === REG.length && cf1Clear < REG.length && cf2Clear < REG.length) verdict = "Two-factor causality: label + span jointly sufficient";
  else verdict = `Neither CF1 nor CF2 nor CF3 fully sufficient (CF1=${cf1Clear}/10, CF2=${cf2Clear}/10, CF3=${cf3Clear}/10); third factor required: ${noneSufficient.join(", ")}`;

  const report = {
    stage: "P5_4_STAGE1_1_COUNTERFACTUAL", provider_requests: 0,
    method: "attemptCompileV4 replay over A1 variants; CF1 adds ONLY golden function.label; CF2 replaces ONLY equation provenance.span; CF3 applies both",
    totals: { cf1_clear: cf1Clear, cf2_clear: cf2Clear, cf3_clear: cf3Clear, cf1_error_count_reduced: cf1Better, cf2_error_count_reduced: cf2Better, not_cleared_by_any: noneSufficient },
    verdict, rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(verdict);
  for (const r of rows) console.log(`${r.case_id} CF0(${r.CF0.counts.total}err:${r.CF0.errors.join("+") || "clean"}) CF1(${r.CF1.counts.total}err:${r.CF1.errors.join("+") || "clean"}) CF2(${r.CF2.counts.total}err:${r.CF2.errors.join("+") || "clean"}) CF3(${r.CF3.counts.total}err:${r.CF3.errors.join("+") || "clean"})`);
}
main();
