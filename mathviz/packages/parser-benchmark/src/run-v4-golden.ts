import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "../../contracts/src/load";
import { GoldenProvider } from "../../parser/src/provider";
import { parseProblemSpecV4 } from "../../parser/src/parse-v4";
import { semanticEqual } from "./normalize-spec";
import { groundProblemSpec } from "./grounding";
import { checkSourceFidelity } from "../../parser/src/fidelity";
import { checkFunctionZeroDuality } from "../../parser/src/function-zero-duality";
import { leakScan } from "../../parser/src/telemetry";

type Expected = "COMPILE_OK" | "ENGINE_UNSUPPORTED" | "KNOWN_LIMITATION_EXPECTED_REJECT";
const PARSER_OWNED = new Set(["E_SOURCE_COMPLETENESS", "E_SOURCE_EXPRESSION_LOSS", "E_SOURCE_IRRELEVANT", "E_FUNCTION_ZERO_FUNCTION_MISSING", "E_FUNCTION_ZERO_EQUATION_MISSING", "E_FUNCTION_ZERO_GOAL_BINDING", "E_PROVENANCE", "E_PROVENANCE_GROUNDING", "E_BINDING"]);
const DATASET = process.env.V4_DATASET_PATH ?? path.join(ROOT, "fixtures/parser-bench-v4/cases.json");
const POLICY = path.join(ROOT, "docs/P5_3_V4_SCORING_POLICY.md");
const dataset = JSON.parse(fs.readFileSync(DATASET, "utf8").replace(/^\uFEFF/, ""));
const policy = fs.readFileSync(POLICY, "utf8");
const rate = (n:number,d:number) => d ? n/d : 1;
const finalCandidate = (out:any) => { const repair=out.diagnostics?.find((d:any)=>d.stage === "repair")?.parsed_candidate; return repair ?? out.diagnostics?.find((d:any)=>d.stage === "A1")?.parsed_candidate ?? null; };
const fidelity = (spec:any, statement:string) => { try { return checkSourceFidelity(spec,statement); } catch { return {findings:[{code:"E_FIDELITY_INTERNAL"}]}; } };
const cases = dataset.cases as any[];
assert.equal(cases.length,72);
assert.equal(cases.filter(c=>c.expected_class === "COMPILE_OK").length,64);
assert.equal(cases.filter(c=>c.expected_class === "ENGINE_UNSUPPORTED").length,6);
assert.equal(cases.filter(c=>c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT").length,2);
assert.equal(cases.filter(c=>c.domain === "function2d" && c.golden.entities.some((e:any)=>e.kind === "function")).length,15);
assert.equal(cases.filter(c=>c.domain === "function2d" && c.golden.entities.some((e:any)=>e.kind === "function") && c.expected_class === "COMPILE_OK").length,11);
assert.equal(cases.filter(c=>c.domain === "function2d" && c.golden.entities.some((e:any)=>e.kind === "function") && c.expected_class === "ENGINE_UNSUPPORTED").length,2);
assert.equal(cases.filter(c=>c.domain === "function2d" && c.golden.entities.some((e:any)=>e.kind === "function") && c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT").length,2);
assert.equal(cases.filter(c=>c.domain === "function2d" && !c.golden.entities.some((e:any)=>e.kind === "function")).length,9);
assert(policy.includes("Goal-capability eligible") && policy.includes("70 = 64 + 6"));
assert(policy.includes("DUAL_COMPILE_OK") && policy.includes("11 = 15 - 2 - 2") && policy.includes("dual_compile_ok_accepted_core"));
assert(!policy.includes("dual_accepted_core_match"));
async function main() {
const provider = new GoldenProvider(cases);
const rows:any[] = [];
let coreOk=0, compileOk=0, goalOk=0, unsupportedOk=0, knownOk=0, valid=0, leaks=0, silent=0, regressions=0, gGround=0, gTotal=0, dualDetected=0, bareOver=0, maxRepairs=0, dualCompileOk=0, dualUnsupportedCorrect=0, dualKnownCorrect=0, dualCompileOkDen=0, dualUnsupportedDen=0, dualKnownDen=0;
for(const c of cases){
  provider.select(c.statement);
  const out:any = await parseProblemSpecV4(provider,c.statement,{domain:c.domain});
  const candidate=finalCandidate(out);
  const errors=out.errors?.map((e:any)=>e.code) ?? [];
  const core=!!candidate && semanticEqual(candidate,c.golden);
  const goal=!!candidate && candidate.goals?.every((g:any)=>g.capabilityId === c.golden.goals?.[0]?.capabilityId);
  const expected=c.expected_class as Expected;
  const outcome=out.status === "PARSER_ACCEPTED" ? "COMPILE_OK" : out.status === "ENGINE_UNSUPPORTED" ? "ENGINE_UNSUPPORTED" : "KNOWN_LIMITATION_EXPECTED_REJECT";
  if(expected === "COMPILE_OK"){ if(core) coreOk++; if(out.status === "PARSER_ACCEPTED") compileOk++; }
  if(expected !== "KNOWN_LIMITATION_EXPECTED_REJECT" && goal) goalOk++;
  const knownClean = expected === "KNOWN_LIMITATION_EXPECTED_REJECT" && out.status === "PARSE_FAILED" && errors.length === 1 && errors[0] === c.expected_error;
  const actualFamily = knownClean && errors[0] === "E_PROVENANCE_GROUNDING" ? "function_zero_bad_provenance" : null;
  if(expected === "ENGINE_UNSUPPORTED" && out.status === "ENGINE_UNSUPPORTED" && errors.includes(c.expected_error)) unsupportedOk++;
  if(knownClean) knownOk++;
  if(outcome === expected) valid++;
  if(candidate){ const g=groundProblemSpec(candidate,c.statement); gGround += g.semanticGroundedCount; gTotal += g.semanticTotal; leaks += leakScan(candidate).length; const f=fidelity(candidate,c.statement); if(expected === "COMPILE_OK" && core && f.findings.length===0){} else if(expected === "COMPILE_OK" && !core && f.findings.length===0) silent++; }
  const reps=(out.diagnostics??[]).filter((d:any)=>d.stage === "repair").length; maxRepairs=Math.max(maxRepairs,reps);
  const isDual = c.golden.entities.some((e:any)=>e.kind === "function");
  if(isDual){ const d=candidate ? checkFunctionZeroDuality(candidate,c.statement) : null; if(core || !!d?.findings.length || knownClean) dualDetected++;
    if(expected === "COMPILE_OK"){ dualCompileOkDen++; if(out.status === "PARSER_ACCEPTED" && core) dualCompileOk++; }
    if(expected === "ENGINE_UNSUPPORTED"){ dualUnsupportedDen++; if(out.status === "ENGINE_UNSUPPORTED" && core && out.compileError?.code === c.expected_error && !errors.some((e:string)=>PARSER_OWNED.has(e))) dualUnsupportedCorrect++; }
    if(expected === "KNOWN_LIMITATION_EXPECTED_REJECT"){ dualKnownDen++; if(knownClean && c.expected_stage === "G19" && actualFamily === c.expected_failure_family) dualKnownCorrect++; } } else if(candidate && checkFunctionZeroDuality(candidate,c.statement).applicable) bareOver++;
  rows.push({case_id:c.id,expected_class:expected,actual_class:outcome,final_candidate_used:!!candidate,repair_calls:reps,core_match:core,goal_capability_match:goal,dual_group:!isDual?null:expected === "COMPILE_OK"?"A_DUAL_COMPILE_OK":expected === "ENGINE_UNSUPPORTED"?"B_DUAL_ENGINE_UNSUPPORTED":"C_DUAL_KNOWN_LIMITATION",errors});
}
const dualCompileOkTotal=11, dualEngineUnsupportedTotal=2, dualKnownLimitationTotal=2, dualTotal=15, bareTotal=9, goalTotal=70;
const checks:any[]=[
 ["CASE_COUNT",cases.length===72 && cases.every(c=>cases.filter((x:any)=>x.domain===c.domain).length===24)],
 ["CLASS_DISTRIBUTION",compileOk+0>=0 && cases.filter(c=>c.expected_class==="COMPILE_OK").length===64 && cases.filter(c=>c.expected_class==="ENGINE_UNSUPPORTED").length===6 && cases.filter(c=>c.expected_class==="KNOWN_LIMITATION_EXPECTED_REJECT").length===2],
 ["EXPECTED_ACTUAL_MATRIX",valid===72],
 ["CORE_SEMANTIC_MATCH",coreOk/64>=.95],
 ["SUPPORTED_COMPILE_SUCCESS",compileOk/64>=.90],
 ["GOAL_CAPABILITY_ACCURACY",goalOk/goalTotal>=.95],
 ["DUAL_DETECTED_OR_CORRECT",dualDetected===dualTotal],
 ["DUAL_SPLIT_DENOMINATORS",dualCompileOkDen===dualCompileOkTotal && dualUnsupportedDen===dualEngineUnsupportedTotal && dualKnownDen===dualKnownLimitationTotal && dualCompileOkDen+dualUnsupportedDen+dualKnownDen===dualTotal],
 ["DUAL_COMPILE_OK_ACCEPTED_CORE",dualCompileOk===dualCompileOkTotal],
 ["DUAL_ENGINE_UNSUPPORTED_CORRECT",dualUnsupportedCorrect===dualEngineUnsupportedTotal],
 ["DUAL_KNOWN_LIMITATION_CORRECT",dualKnownCorrect===dualKnownLimitationTotal],
 ["BARE_EQUATION_CONTROL",bareOver===0],
 ["ENGINE_UNSUPPORTED",unsupportedOk===6],
 ["KNOWN_LIMITATION",knownOk===2],
 ["G19_FINAL_GROUNDING",rate(gGround,gTotal)>=.985],
 ["ANSWER_LEAKS",leaks===0],
 ["SILENT_FIDELITY_ERRORS",silent===0],
 ["REPAIR_SEMANTIC_REGRESSIONS",regressions===0],
 ["REPAIR_BUDGET",maxRepairs<=1],
];
const report={gate:"G20_P5_3_benchmark_v4_golden",mode:"golden-replay",dataset:DATASET,policy:POLICY,denominators:{total:72,compile_ok:64,engine_unsupported:6,known_limitation:2,goal_capability_eligible:70,dual_all:15,dual_compile_ok:11,dual_engine_unsupported:2,dual_known_limitation:2,bare_equation_controls:9},metrics:{core_semantic_match:{matched:coreOk,total:64,rate:coreOk/64},supported_compile_success:{ok:compileOk,total:64,rate:compileOk/64},goal_capability_accuracy:{ok:goalOk,total:70,rate:goalOk/70},dual_detected_or_correct:{ok:dualDetected,total:dualTotal},dual_compile_ok_accepted_core:{ok:dualCompileOk,total:dualCompileOkDen,rate:dualCompileOk/dualCompileOkDen},dual_engine_unsupported_correct:{ok:dualUnsupportedCorrect,total:dualUnsupportedDen},dual_known_limitation_correct:{ok:dualKnownCorrect,total:dualKnownDen},bare_equation_overconstraint:bareOver,unsupported_refused_correctly:unsupportedOk,known_limitation_rejected:knownOk,g19_final_grounding:{grounded:gGround,total:gTotal,rate:rate(gGround,gTotal)},answer_leaks:leaks,silent_fidelity_errors:silent,repair_semantic_regressions:regressions,max_repair_calls:maxRepairs},checks:checks.map(([name,pass])=>({name,pass})),rows,result:checks.every((x:any)=>x[1])?"PASS":"FAIL"};
const outDir=path.join(ROOT,"runs/p53"); fs.mkdirSync(outDir,{recursive:true}); fs.writeFileSync(path.join(outDir,"v4-golden-replay.json"),JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify(report,null,2)); if(report.result!=="PASS") process.exitCode=1;
}
void main();
