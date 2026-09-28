// P5.3 benchmark v3 freeze verifier. v2 freeze is deliberately untouched.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { sha256File } from "./freeze";
const datasetPath = path.join(ROOT, "fixtures", "parser-bench-v3", "cases.json");
const freezePath = path.join(ROOT, "fixtures", "parser-bench-v3", "freeze-v3.json");
const policyPath = path.join(ROOT, "docs", "P5_3_SCORING_POLICY.md");
export function verifyFreezeV3(): any {
  const lock = JSON.parse(fs.readFileSync(freezePath, "utf8"));
  const ds = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const actualDataset = sha256File(datasetPath);
  const actualPolicy = sha256File(policyPath);
  if (lock.dataset_version !== 3 || lock.case_count !== 72 || ds.version !== 3 || ds.cases?.length !== 72) throw new Error("P5.3 freeze version/count mismatch");
  if (lock.dataset_sha256 !== actualDataset) throw new Error(`P5.3 dataset freeze mismatch: expected ${lock.dataset_sha256}, got ${actualDataset}`);
  if (lock.scoring_policy_sha256 !== actualPolicy) throw new Error(`P5.3 scoring policy freeze mismatch: expected ${lock.scoring_policy_sha256}, got ${actualPolicy}`);
  return lock;
}
if (require.main === module) {
  const lock = verifyFreezeV3();
  console.log(`P5.3 freeze verified: dataset=${lock.dataset_sha256}; policy=${lock.scoring_policy_sha256}; cases=${lock.case_count}`);
}
