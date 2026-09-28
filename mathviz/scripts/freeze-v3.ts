import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../packages/contracts/src/load";
import { sha256File } from "../packages/parser-benchmark/src/freeze";
import { attemptCompile } from "../packages/parser/src/parse";

const datasetPath = path.join(ROOT, "fixtures", "parser-bench-v3", "cases.json");
const policyPath = path.join(ROOT, "docs", "P5_3_SCORING_POLICY.md");
const lockPath = path.join(ROOT, "fixtures", "parser-bench-v3", "freeze-v3.json");
const challengeKinds = ["declared-entity-completeness", "irrelevant-grounded-distractor", "expression-term-loss", "multi-finding-one-repair"];

function main() {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const cases = dataset.cases ?? [];
  if (dataset.version !== 3 || cases.length !== 72) throw new Error("expected v3 dataset with exactly 72 cases");
  if (new Set(cases.map((c: any) => c.id)).size !== 72) throw new Error("case ids must be unique");
  for (const d of ["geometry2d", "motion1d", "function2d"]) {
    const rows = cases.filter((c: any) => c.domain === d);
    if (rows.length !== 24) throw new Error(`${d} must contain 24 cases`);
    const required: Record<string, number> = { straightforward: 8, wording: 4, irrelevant: 4, compositional: 4, unsupported: 2, harder_repair: 2 };
    for (const [cat, count] of Object.entries(required)) if (rows.filter((c: any) => c.category === cat).length !== count) throw new Error(`${d}/${cat} quota mismatch`);
  }
  for (const k of challengeKinds) if (cases.filter((c: any) => c.challengeType === k).length !== 6) throw new Error(`challenge quota mismatch: ${k}`);
  const audit = cases.map((c: any) => {
    const r = attemptCompile(JSON.parse(JSON.stringify(c.golden)), c.statement);
    const ok = c.expected === "COMPILE_OK" ? r.ok
      : c.expected === "ENGINE_UNSUPPORTED" ? !r.ok && r.engineUnsupported
      : c.expected === "KNOWN_LIMITATION_EXPECTED_REJECT" ? !r.ok && !r.engineUnsupported && r.errors.some((e: any) => e.code === "E_PROVENANCE_GROUNDING")
      : false;
    if (!ok) throw new Error(`golden audit failed for ${c.id}: ${JSON.stringify({ expected: c.expected, ok: r.ok, engineUnsupported: r.engineUnsupported, errors: r.errors.map((e: any) => e.code) })}`);
    return { id: c.id, expected: c.expected, outcome: c.expected === "COMPILE_OK" ? "accepted" : c.expected === "ENGINE_UNSUPPORTED" ? "engine_unsupported" : "expected_grounding_reject" };
  });
  const lock = {
    benchmark: "mathviz-parser-benchmark/v3", dataset_version: 3, case_count: cases.length,
    dataset_sha256: sha256File(datasetPath), scoring_policy_sha256: sha256File(policyPath),
    prompt_policy_version: "p5.3-policy-v1", frozen_at_utc: new Date().toISOString(),
    expected_counts: { COMPILE_OK: cases.filter((c: any) => c.expected === "COMPILE_OK").length, ENGINE_UNSUPPORTED: cases.filter((c: any) => c.expected === "ENGINE_UNSUPPORTED").length, KNOWN_LIMITATION_EXPECTED_REJECT: cases.filter((c: any) => c.expected === "KNOWN_LIMITATION_EXPECTED_REJECT").length },
    challenge_counts: Object.fromEntries(challengeKinds.map((k) => [k, cases.filter((c: any) => c.challengeType === k).length])),
    golden_audit: { passed: audit.length, failed: 0, outcomes: audit },
    freeze_rule: "Any correction after this freeze requires a new benchmark version and new preregistered run.",
  };
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
  console.log(`v3 frozen: dataset=${lock.dataset_sha256}; policy=${lock.scoring_policy_sha256}; cases=${lock.case_count}; golden=${audit.length}/${audit.length}`);
}
main();
