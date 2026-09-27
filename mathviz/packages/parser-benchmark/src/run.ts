// P5.1a G18 benchmark runner: request-level safe diagnostics, repair trace,
// decomposed semantic layers and unsupported-case attribution.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { parseProblemSpec } from "../../parser/src/parse";
import { OpenAICompatibleProvider, GoldenProvider } from "../../parser/src/provider";
import { leakScan } from "../../parser/src/telemetry";
import { semanticEqual, semanticLayers } from "./normalize-spec";

const OUT_DIR = path.join(ROOT, "runs", "p51");
interface BenchCase { id: string; domain: string; category: string; statement: string; golden: any; expected: "COMPILE_OK" | "ENGINE_UNSUPPORTED" }
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error("G18 assertion failed: " + msg); }
function spanSupport(spec: any): { valid: number; total: number } {
  let valid = 0, total = 0;
  for (const o of [...(spec?.entities ?? []), ...(spec?.source_facts ?? []), ...(spec?.constraints ?? [])]) {
    total++;
    const s=o?.provenance?.span;
    if (s && typeof s.start==="number" && typeof s.end==="number" && spec.statement.slice(s.start,s.end)===s.text) valid++;
  }
  return { valid, total };
}
async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR,{recursive:true});
  const dataset=JSON.parse(fs.readFileSync(path.join(ROOT,"fixtures","parser-bench","cases.json"),"utf8"));
  const cases:BenchCase[]=dataset.cases;
  assert(cases.length===60,"expected 60 cases");
  for(const d of ["geometry2d","motion1d","function2d"]) assert(cases.filter(c=>c.domain===d).length===20,`${d} must have 20 cases`);
  const live=OpenAICompatibleProvider.fromEnv();
  const mode=live?"live":"replay";
  const providerFor=(c:BenchCase)=>live??new GoldenProvider([{statement:c.statement,domain:c.domain,golden:c.golden}]);
  console.log(`G18 mode: ${mode}${live?` (${live.id})`:" (GoldenProvider — plumbing check only)"}`);
  const rows:any[]=[], diagnosticRows:any[]=[];
  const tokenTotals={input_tokens:0,output_tokens:0};
  const layerCounters:Record<string,{match:number;total:number}>={goal_semantics:{match:0,total:0},entity_graph:{match:0,total:0},numerical_facts:{match:0,total:0},expressions:{match:0,total:0},provenance:{match:0,total:0}};
  const m={domainOk:0,valid:0,semanticMatch:0,goalCapOk:0,supportedCompileOk:0,supportedTotal:0,unsupportedRefused:0,unsupportedTotal:0,unsupportedSemanticCorruption:0,repairUsed:0,leaks:0,spanValid:0,spanTotal:0};
  for(const c of cases){
    const out=await parseProblemSpec(providerFor(c) as any,c.statement,{noCache:true});
    tokenTotals.input_tokens+=out.usage.total.input_tokens; tokenTotals.output_tokens+=out.usage.total.output_tokens;
    if(out.repairUsed)m.repairUsed++;
    const domainOk=out.domain===c.domain;if(domainOk)m.domainOk++;
    const valid=out.status==="PARSER_ACCEPTED"||out.status==="ENGINE_UNSUPPORTED";if(valid)m.valid++;
    let semantic:boolean|null=null, layers:any=null, diff:any=null, span={valid:0,total:0};
    if(out.spec){
      const exp=semanticLayers(c.golden),act=semanticLayers(out.spec);
      layers=Object.fromEntries(Object.keys(exp).map(k=>{const match=exp[k]===act[k];layerCounters[k]??={match:0,total:0};layerCounters[k].total++;if(match)layerCounters[k].match++;return[k,{match}];}));
      span=spanSupport(out.spec);m.spanValid+=span.valid;m.spanTotal+=span.total;
      const wantCaps=c.golden.goals.map((g:any)=>g.capabilityId).sort(),gotCaps=(out.spec.goals??[]).map((g:any)=>g.capabilityId).sort();
      if(canonical(wantCaps)===canonical(gotCaps))m.goalCapOk++;
      if(leakScan(out.spec).length)m.leaks++;
      diff={exact_core_match:semanticEqual(out.spec,c.golden),expected_goal_capabilities:wantCaps,actual_goal_capabilities:gotCaps,expected_entity_count:c.golden.entities.length,actual_entity_count:out.spec.entities?.length??0,expected_fact_count:c.golden.source_facts.length,actual_fact_count:out.spec.source_facts?.length??0};
    }
    if(out.status==="PARSER_ACCEPTED"&&c.expected==="COMPILE_OK"){semantic=semanticEqual(out.spec,c.golden);if(semantic)m.semanticMatch++;}
    if(c.expected==="COMPILE_OK"){m.supportedTotal++;if(out.status==="PARSER_ACCEPTED")m.supportedCompileOk++;}
    else {m.unsupportedTotal++;if(out.status==="ENGINE_UNSUPPORTED")m.unsupportedRefused++;if(out.status==="PARSER_ACCEPTED"&&!semanticEqual(out.spec,c.golden))m.unsupportedSemanticCorruption++;}
    const classification=c.expected==="ENGINE_UNSUPPORTED"?(out.status==="ENGINE_UNSUPPORTED"?"correct_engine_refusal":out.status==="PARSER_ACCEPTED"?"semantic_corruption_or_support_mismatch":"parse_or_validation_failure"):(out.status==="PARSER_ACCEPTED"?(semantic?"core_semantic_match":"valid_core_mismatch"):"parse_or_compile_failure");
    rows.push({id:c.id,domain:c.domain,category:c.category,expected:c.expected,status:out.status,routedDomain:out.domain,domainOk,valid,semantic,semanticLayers:layers,classification,repairUsed:out.repairUsed,repairDelta:out.repairDelta,usage:out.usage.total,errors:out.errors,compileError:out.compileError??null,normalizedDiff:diff,provenanceSpanSupport:span});
    diagnosticRows.push({id:c.id,statement:c.statement,expected:c.expected,status:out.status,calls:out.diagnostics.map(d=>({stage:d.stage,raw_text:d.raw_text??null,parsed_candidate:d.parsed_candidate??null,model:d.model??null,finish_reason:d.finish_reason??null,request_id:d.request_id??null,usage:d.usage,errors:d.errors??[]})),final_candidate:out.spec,compile_error:out.compileError??null,repair_delta:out.repairDelta});
    console.log(`${valid&&domainOk&&(semantic===null||semantic)?"ok ":"DIFF"} ${c.id} -> ${out.status}${out.repairUsed?" (repair)":""} [${classification}]`);
  }
  const pct=(n:number,d:number)=>d===0?1:n/d;
  const summary:any={gate:"G18_parser_benchmark",version:"P5.1a",mode,provider:live?live.id:"golden-replay",cases:cases.length,token_usage:{total:tokenTotals,per_case_average:{input_tokens:Math.round(tokenTotals.input_tokens/cases.length),output_tokens:Math.round(tokenTotals.output_tokens/cases.length)}},metrics:{domain_accuracy:pct(m.domainOk,cases.length),final_schema_semantic_valid:pct(m.valid,cases.length),core_semantic_match:pct(m.semanticMatch,m.supportedTotal),semantic_layers:Object.fromEntries(Object.entries(layerCounters).map(([k,v])=>[k,pct(v.match,v.total)])),goal_capability_accuracy:pct(m.goalCapOk,m.valid),supported_compile_success:pct(m.supportedCompileOk,m.supportedTotal),unsupported_refused_correctly:pct(m.unsupportedRefused,m.unsupportedTotal),unsupported_semantic_corruption:m.unsupportedSemanticCorruption,provenance_span_support:pct(m.spanValid,m.spanTotal),repair_rate:pct(m.repairUsed,cases.length),answer_leaks:m.leaks},thresholds:{final_schema_semantic_valid:0.98,core_semantic_match:0.95,goal_capability_accuracy:0.95,supported_compile_success:0.90,answer_leaks:0}};
  const checks=[["final_schema_semantic_valid",summary.metrics.final_schema_semantic_valid>=0.98],["core_semantic_match",summary.metrics.core_semantic_match>=0.95],["goal_capability_accuracy",summary.metrics.goal_capability_accuracy>=0.95],["supported_compile_success",summary.metrics.supported_compile_success>=0.90],["unsupported_refused_correctly",summary.metrics.unsupported_refused_correctly===1],["answer_leakage_zero",summary.metrics.answer_leaks===0]] as const;
  fs.writeFileSync(path.join(OUT_DIR,"benchmark.json"),JSON.stringify({...summary,rows},null,2)+"\n","utf8");
  fs.writeFileSync(path.join(OUT_DIR,"benchmark-diagnostics.json"),JSON.stringify({mode,provider:summary.provider,cases:diagnosticRows},null,2)+"\n","utf8");
  for(const [k,v] of Object.entries(summary.metrics))console.log(`${k}: ${typeof v==="number"?v.toFixed(4):JSON.stringify(v)}`);
  let ok=true;for(const[n,p]of checks){console.log(`${p?"PASS":"FAIL"} ${n}`);if(!p)ok=false;}
  console.log(`G18_parser_benchmark: ${ok?"PASS":"FAIL"} (${mode})`);if(!ok)process.exit(1);
}
function canonical(x:any):string{return JSON.stringify(x);}
main().catch(e=>{console.error(e);process.exit(1);});
