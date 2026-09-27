// Freeze and verify the v2 parser benchmark/scoring policy before live use.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ROOT } from "../../contracts/src/load";
const datasetPath=path.join(ROOT,"fixtures","parser-bench","cases.json");
const freezePath=path.join(ROOT,"fixtures","parser-bench","freeze-v2.json");
const policyPath=path.join(ROOT,"docs","P5_1B_SCORING_POLICY.md");
export function sha256File(file:string):string{return createHash("sha256").update(fs.readFileSync(file)).digest("hex");}
export function verifyFreeze():any{
 const lock=JSON.parse(fs.readFileSync(freezePath,"utf8"));
 const actual=sha256File(datasetPath);
 if(lock.dataset_sha256!==actual)throw new Error(`G19 benchmark freeze mismatch: expected ${lock.dataset_sha256}, got ${actual}`);
 if(lock.dataset_version!==2||lock.case_count!==60||lock.scoring_policy_sha256!==sha256File(policyPath))throw new Error("G19 benchmark version/policy freeze mismatch");
 return lock;
}
if(require.main===module){const lock=verifyFreeze();console.log(`G19 freeze verified: dataset=${lock.dataset_sha256}; policy=${lock.scoring_policy_sha256}; cases=${lock.case_count}`);}
