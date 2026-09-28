import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../packages/contracts/src/load";
import { attemptCompile } from "../packages/parser/src/parse";

const out: any[] = [];
const sp = (s: string, phrase: string, occurrence = 0) => {
  let from = 0, at = -1;
  for (let n = 0; n <= occurrence; n++) { at = s.indexOf(phrase, from); if (at < 0) throw new Error(`span not found: ${JSON.stringify(phrase)} in ${s}`); from = at + phrase.length; }
  return { kind: "problem_text", span: { text: phrase, start: at, end: at + phrase.length } };
};
const N = (n: number | string) => ({ t: "num", v: { kind: "int", value: String(n) } });
const S = (s: string) => ({ t: "sym", name: s });
const A = (...args: any[]) => ({ t: "app", op: "+", args });
const Sub = (a: any, b: any) => ({ t: "app", op: "-", args: [a, b] });
const Mul = (a: any, b: any) => ({ t: "app", op: "*", args: [a, b] });
const Div = (a: any, b: any) => ({ t: "app", op: "/", args: [a, b] });
const Pow = (a: any, b: any) => ({ t: "app", op: "^", args: [a, N(b)] });
const zero = N(0);
function addCase(id: string, domain: string, category: string, statement: string, expected: string, golden: any, challengeType?: string) {
  out.push({ id, domain, category, statement, expected, ...(challengeType ? { challengeType } : {}), golden });
}
function base(id: string, domain: string, statement: string, entities: any[], source_facts: any[], goals: any[], parameters?: any[], constraints?: any[]) {
  return { schemaVersion: "mathviz.problemspec/v1", problemId: id, domain, statement, ...(parameters?.length ? { parameters } : {}), entities, source_facts, ...(constraints?.length ? { constraints } : {}), goals };
}

// Geometry2D builders: all positive supported cases use the frozen derive_length
// surface. Point and segment spans are exact slices; segment spans cite its label.
function geo(id: string, category: string, statement: string, ax: string, ay: string, bx: string, by: string, opts: { expected?: string; challengeType?: string; cPoint?: [string,string] } = {}) {
  const aPhrase = `A(${ax}, ${ay})`, bPhrase = `B(${bx}, ${by})`;
  const aAt = statement.indexOf(aPhrase), bAt = statement.indexOf(bPhrase);
  const segAt = statement.indexOf("AB");
  const segSpan = segAt >= 0 ? { kind: "problem_text", span: { text: "AB", start: segAt, end: segAt + 2 } } : { kind: "problem_text", span: { text: statement.slice(aAt, bAt + bPhrase.length), start: aAt, end: bAt + bPhrase.length } };
  const entities: any[] = [
    { id: "PA", kind: "point", label: "A", props: { x: ax, y: ay }, provenance: sp(statement, aPhrase) },
    { id: "PB", kind: "point", label: "B", props: { x: bx, y: by }, provenance: sp(statement, bPhrase) },
    { id: "SEG", kind: "segment", label: "AB", props: { a: "PA", b: "PB" }, provenance: segSpan }
  ];
  if (opts.cPoint) { const [cx,cy] = opts.cPoint; /* intentional source distractor: omitted from minimal golden */ void cx; void cy; }
  const golden = base(id, "geometry2d", statement, entities, [], [{ goalId: "g_len", capabilityId: "geometry2d.derive_length", inputs: ["entity:SEG"] }]);
  addCase(id, "geometry2d", category, statement, opts.expected ?? "COMPILE_OK", golden, opts.challengeType);
}

// Geometry: 8 straightforward.
geo("g3_sf_01","straightforward","已知点 A(1, 2) 与点 B(4, 6)，求线段 AB 的长度。","1","2","4","6");
geo("g3_sf_02","straightforward","点 A(0, 3) 和点 B(0, 11) 确定线段 AB，求其长度。","0","3","0","11");
geo("g3_sf_03","straightforward","已知 A(2, 1)、B(8, 1)，求 AB 的长度。","2","1","8","1");
geo("g3_sf_04","straightforward","点 A(5, 2) 与点 B(5, 9) 之间的距离是多少？","5","2","5","9");
geo("g3_sf_05","straightforward","已知点 A(3, 4) 和点 B(9, 12)，计算线段 AB 长度。","3","4","9","12");
geo("g3_sf_06","straightforward","A(7, 0) 与 B(7, 5) 两点相连，求 AB 长。","7","0","7","5");
geo("g3_sf_07","straightforward","点 A(1, 8)、点 B(6, 8)，线段 AB 有多长？","1","8","6","8");
geo("g3_sf_08","straightforward","已知 A(4, 2) 和 B(10, 2)，求两点间距离。","4","2","10","2");
// 4 wording variants.
geo("g3_wd_01","wording","若 A(2, 3)、B(6, 6)，连接 AB 后求这条线段的长度。","2","3","6","6");
geo("g3_wd_02","wording","坐标为 A(0, 0) 和 B(9, 12)，请计算 A、B 间的直线距离。","0","0","9","12");
geo("g3_wd_03","wording","从 A(3, 1) 到 B(3, 13) 的线段长度是多少？","3","1","3","13");
geo("g3_wd_04","wording","给定两个点 A(5, 5)、B(12, 5)，求 AB 的长度。","5","5","12","5");
// 4 irrelevant-information cases; first two are precision challenges.
geo("g3_ir_01","irrelevant","教室有 18 把椅子。已知 A(1, 1) 与 B(4, 5)，求 AB 的长度。","1","1","4","5",{challengeType:"irrelevant-grounded-distractor"});
geo("g3_ir_02","irrelevant","路旁每隔 7 米有一盏灯。点 A(2, 0) 与 B(8, 8) 的距离是多少？","2","0","8","8",{challengeType:"irrelevant-grounded-distractor"});
geo("g3_ir_03","irrelevant","操场周长是 240 米。已知 A(0, 4)、B(0, 13)，求 AB 长度。","0","4","0","13");
geo("g3_ir_04","irrelevant","今天气温 22 摄氏度。求点 A(6, 2) 到点 B(6, 10) 的距离。","6","2","6","10");
// 4 compositional cases. The C point is explicit contextual geometry but is
// intentionally outside the requested AB dependency closure in the golden.
geo("g3_cp_01","compositional","已知 A(0, 2)、B(5, 6)、C(9, 1)，只求线段 AB 的长度。","0","2","5","6",{challengeType:"multi-finding-one-repair",cPoint:["9","1"]});
geo("g3_cp_02","compositional","图中三点为 A(2, 2)、B(8, 7)、C(3, 10)，问题只问 AB 有多长。","2","2","8","7",{challengeType:"multi-finding-one-repair",cPoint:["3","10"]});
geo("g3_cp_03","compositional","点 A(1, 3)、B(11, 3) 与 C(5, 9) 已知，求线段 AB 的长度。","1","3","11","3",{cPoint:["5","9"]});
geo("g3_cp_04","compositional","给出 A(4, 1)、B(9, 13)、C(12, 2)，请只计算 A 与 B 之间的距离。","4","1","9","13",{cPoint:["12","2"]});
// 2 unsupported exact-number surfaces (bounded fail-closed engine refusal).
geo("g3_un_01","unsupported","已知 A(1, 0) 与 B(sqrt(3), 0)，求线段 AB 的长度。","1","0","sqrt(3)","0",{expected:"ENGINE_UNSUPPORTED"});
geo("g3_un_02","unsupported","点 A(0, 2) 和点 B(2*sqrt(5), 2) 确定 AB，求其长度。","0","2","2*sqrt(5)","2",{expected:"ENGINE_UNSUPPORTED"});
// 2 harder span variants.
geo("g3_hr_01","harder_repair","先给出 A(3, 7) 与 B(15, 7)，再问两点间距离。","3","7","15","7");
geo("g3_hr_02","harder_repair","测得点 A(4, 6)，另一个端点 B(13, 18)；线段 AB 多长？","4","6","13","18");

// Motion1D builders. Supported samples use explicit per-body direction; the
// two known-limitation rows deliberately encode direction only relationally.
function fact(statement: string, id: string, name: string, value: string, unit: string, phrase: string) {
  return { fact_id: id, name, unit, value: { kind: "int", value }, provenance: sp(statement, phrase) };
}
function motionReach(id: string, category: string, statement: string, bodyPhrase: string, posPhrase: string, pos: string, velPhrase: string, vel: string, targetPhrase: string, target: string, opts: { challengeType?: string } = {}) {
  const facts = [fact(statement,`${id}_x0`,"initial_position",pos,"m",posPhrase),fact(statement,`${id}_v`,"velocity",vel,"m/s",velPhrase),fact(statement,`${id}_target`,"target_position",target,"m",targetPhrase)];
  const golden = base(id,"motion1d",statement,[{id:"BODY",kind:"body",props:{capability_id:"motion1d.constant_velocity",initial_position:`math:fact:${id}_x0`,segments:[{velocity:`math:fact:${id}_v`}]},provenance:sp(statement,bodyPhrase)}],facts,[{goalId:"g_reach",capabilityId:"motion1d.reach_event",inputs:["entity:BODY",`fact:${id}_target`]}]);
  addCase(id,"motion1d",category,statement,"COMPILE_OK",golden,opts.challengeType);
}
function motionMeeting(id: string, category: string, statement: string, clauseA: string, clauseB: string, posAPhrase: string, posA: string, velAPhrase: string, velA: string, posBPhrase: string, posB: string, velBPhrase: string, velB: string, opts: { challengeType?: string; knownLimit?: boolean } = {}) {
  const facts = [fact(statement,`${id}_xA`,"A_initial",posA,"m",posAPhrase),fact(statement,`${id}_vA`,"A_velocity",velA,"m/s",velAPhrase),fact(statement,`${id}_xB`,"B_initial",posB,"m",posBPhrase),fact(statement,`${id}_vB`,"B_velocity",velB,"m/s",velBPhrase)];
  const golden = base(id,"motion1d",statement,[
    {id:"A",kind:"body",props:{capability_id:"motion1d.constant_velocity",initial_position:`math:fact:${id}_xA`,segments:[{velocity:`math:fact:${id}_vA`}]},provenance:sp(statement,clauseA)},
    {id:"B",kind:"body",props:{capability_id:"motion1d.constant_velocity",initial_position:`math:fact:${id}_xB`,segments:[{velocity:`math:fact:${id}_vB`}]},provenance:sp(statement,clauseB)}
  ],facts,[{goalId:"g_meet",capabilityId:"motion1d.meeting_event",inputs:["entity:A","entity:B"]}]);
  addCase(id,"motion1d",category,statement,opts.knownLimit?"KNOWN_LIMITATION_EXPECTED_REJECT":"COMPILE_OK",golden,opts.challengeType);
}
function motionOvertakeUnsupported(id:string, statement:string, clauseA:string, clauseB:string, pA:string,vA:string,pB:string,vB:string) {
  const facts=[fact(statement,`${id}_xA`,"A_initial",pA,"m",`位置 ${pA} m`),fact(statement,`${id}_vA`,"A_velocity",vA,"m/s",`以 ${vA} m/s 匀速前进`),fact(statement,`${id}_xB`,"B_initial",pB,"m",`位置 ${pB} m`),fact(statement,`${id}_vB`,"B_velocity",vB,"m/s",`以 ${vB} m/s 同向前进`)];
  const golden=base(id,"motion1d",statement,[{id:"A",kind:"body",props:{capability_id:"motion1d.constant_velocity",initial_position:`math:fact:${id}_xA`,segments:[{velocity:`math:fact:${id}_vA`}]},provenance:sp(statement,clauseA)},{id:"B",kind:"body",props:{capability_id:"motion1d.constant_velocity",initial_position:`math:fact:${id}_xB`,segments:[{velocity:`math:fact:${id}_vB`}]},provenance:sp(statement,clauseB)}],facts,[{goalId:"g_over",capabilityId:"motion1d.overtake_event",inputs:["entity:A","entity:B"]}]);
  addCase(id,"motion1d","unsupported",statement,"ENGINE_UNSUPPORTED",golden);
}
function motionKnown(id:string, statement:string, clauseA:string, clauseB:string, posAPhrase:string,posA:string,velAPhrase:string, speedA:string,posBPhrase:string,posB:string,velBPhrase:string,speedB:string, challengeType?:string) {
  motionMeeting(id,"harder_repair",statement,clauseA,clauseB,posAPhrase,posA,velAPhrase,speedA,posBPhrase,posB,velBPhrase,`-${speedB}`,{knownLimit:true,challengeType});
}
// Motion: straightforward 8 (four reach + four explicit-direction meetings).
motionReach("m3_sf_01","straightforward","甲从位置 0 m 出发，以 4 m/s 匀速前进。问甲何时到达位置 28 m？","甲从位置 0 m 出发，以 4 m/s 匀速前进","位置 0 m","0","以 4 m/s 匀速前进","4","位置 28 m","28");
motionReach("m3_sf_02","straightforward","乙从位置 5 m 出发，以 3 m/s 匀速前进。乙到达位置 20 m 需要多久？","乙从位置 5 m 出发，以 3 m/s 匀速前进","位置 5 m","5","以 3 m/s 匀速前进","3","位置 20 m","20");
motionReach("m3_sf_03","straightforward","丙从位置 30 m 出发，以 2 m/s 匀速后退。问丙到达位置 10 m 的时间。","丙从位置 30 m 出发，以 2 m/s 匀速后退","位置 30 m","30","以 2 m/s 匀速后退","-2","位置 10 m","10");
motionReach("m3_sf_04","straightforward","丁从位置 8 m 出发，以 5 m/s 匀速前进。多久能到位置 48 m？","丁从位置 8 m 出发，以 5 m/s 匀速前进","位置 8 m","8","以 5 m/s 匀速前进","5","位置 48 m","48");
motionMeeting("m3_sf_05","straightforward","甲从位置 0 m 出发，以 6 m/s 匀速前进；乙从位置 90 m 出发，以 3 m/s 匀速后退。问何时相遇？","甲从位置 0 m 出发，以 6 m/s 匀速前进","乙从位置 90 m 出发，以 3 m/s 匀速后退","位置 0 m","0","以 6 m/s 匀速前进","6","位置 90 m","90","以 3 m/s 匀速后退","-3");
motionMeeting("m3_sf_06","straightforward","甲从位置 10 m 出发，以 2 m/s 匀速前进；乙从位置 70 m 出发，以 4 m/s 匀速后退。问它们何时相遇？","甲从位置 10 m 出发，以 2 m/s 匀速前进","乙从位置 70 m 出发，以 4 m/s 匀速后退","位置 10 m","10","以 2 m/s 匀速前进","2","位置 70 m","70","以 4 m/s 匀速后退","-4");
motionMeeting("m3_sf_07","straightforward","甲从位置 4 m 出发，以 3 m/s 匀速前进；乙从位置 40 m 出发，以 3 m/s 匀速后退。求相遇时间。","甲从位置 4 m 出发，以 3 m/s 匀速前进","乙从位置 40 m 出发，以 3 m/s 匀速后退","位置 4 m","4","以 3 m/s 匀速前进","3","位置 40 m","40","以 3 m/s 匀速后退","-3");
motionMeeting("m3_sf_08","straightforward","甲从位置 2 m 出发，以 5 m/s 匀速前进；乙从位置 62 m 出发，以 1 m/s 匀速后退。问相遇时刻。","甲从位置 2 m 出发，以 5 m/s 匀速前进","乙从位置 62 m 出发，以 1 m/s 匀速后退","位置 2 m","2","以 5 m/s 匀速前进","5","位置 62 m","62","以 1 m/s 匀速后退","-1");
// Motion: wording 4.
motionReach("m3_wd_01","wording","戊以 4 m/s 向前匀速运动，起点在 3 m，问到 31 m 要几秒？","戊以 4 m/s 向前匀速运动，起点在 3 m","起点在 3 m","3","以 4 m/s 向前匀速运动","4","到 31 m","31");
motionReach("m3_wd_02","wording","己从 6 m 处以 2 m/s 匀速向前行进，到 18 m 需多长时间？","己从 6 m 处以 2 m/s 匀速向前行进","从 6 m 处","6","以 2 m/s 匀速向前行进","2","到 18 m","18");
motionMeeting("m3_wd_03","wording","甲在 0 m 处以 4 m/s 向前走，乙在 52 m 处以 2 m/s 向后走，多久会相遇？","甲在 0 m 处以 4 m/s 向前走","乙在 52 m 处以 2 m/s 向后走","在 0 m 处","0","以 4 m/s 向前走","4","在 52 m 处","52","以 2 m/s 向后走","-2");
motionMeeting("m3_wd_04","wording","甲车由 9 m 站点以 3 m/s 匀速前进，乙车由 45 m 站点以 3 m/s 匀速后退，何时相遇？","甲车由 9 m 站点以 3 m/s 匀速前进","乙车由 45 m 站点以 3 m/s 匀速后退","由 9 m 站点","9","以 3 m/s 匀速前进","3","由 45 m 站点","45","以 3 m/s 匀速后退","-3");
// Motion: irrelevant 4, first two are challenge distractors.
motionReach("m3_ir_01","irrelevant","路边每隔 8 m 有一根标杆。甲从位置 0 m 出发，以 2 m/s 匀速前进，问到位置 20 m 的时间。","甲从位置 0 m 出发，以 2 m/s 匀速前进","位置 0 m","0","以 2 m/s 匀速前进","2","位置 20 m","20",{challengeType:"irrelevant-grounded-distractor"});
motionReach("m3_ir_02","irrelevant","公园有 14 盏路灯。乙从位置 1 m 出发，以 3 m/s 匀速前进，到位置 25 m 要多久？","乙从位置 1 m 出发，以 3 m/s 匀速前进","位置 1 m","1","以 3 m/s 匀速前进","3","位置 25 m","25",{challengeType:"irrelevant-grounded-distractor"});
motionMeeting("m3_ir_03","irrelevant","操场一圈长 400 m。甲从位置 0 m 出发，以 5 m/s 匀速前进；乙从位置 80 m 出发，以 5 m/s 匀速后退。问相遇时间。","甲从位置 0 m 出发，以 5 m/s 匀速前进","乙从位置 80 m 出发，以 5 m/s 匀速后退","位置 0 m","0","以 5 m/s 匀速前进","5","位置 80 m","80","以 5 m/s 匀速后退","-5");
motionReach("m3_ir_04","irrelevant","今天最高气温 27 摄氏度。丙从位置 10 m 出发，以 4 m/s 匀速前进，到 34 m 需几秒？","丙从位置 10 m 出发，以 4 m/s 匀速前进","位置 10 m","10","以 4 m/s 匀速前进","4","到 34 m","34");
// Motion: compositional 4, first two challenge simultaneous multi-findings.
motionMeeting("m3_cp_01","compositional","甲从位置 0 m 出发，以 4 m/s 匀速前进；乙从位置 60 m 出发，以 2 m/s 匀速后退。路旁每 10 m 有一块牌子。问何时相遇？","甲从位置 0 m 出发，以 4 m/s 匀速前进","乙从位置 60 m 出发，以 2 m/s 匀速后退","位置 0 m","0","以 4 m/s 匀速前进","4","位置 60 m","60","以 2 m/s 匀速后退","-2",{challengeType:"multi-finding-one-repair"});
motionReach("m3_cp_02","compositional","丁从位置 12 m 出发，以 3 m/s 匀速前进，途中每 6 m 有一盏灯；问丁到 42 m 的时间。","丁从位置 12 m 出发，以 3 m/s 匀速前进","位置 12 m","12","以 3 m/s 匀速前进","3","到 42 m","42",{challengeType:"multi-finding-one-repair"});
motionMeeting("m3_cp_03","compositional","甲从位置 5 m 出发，以 7 m/s 匀速前进；乙从位置 95 m 出发，以 4 m/s 匀速后退。问两人何时相遇？","甲从位置 5 m 出发，以 7 m/s 匀速前进","乙从位置 95 m 出发，以 4 m/s 匀速后退","位置 5 m","5","以 7 m/s 匀速前进","7","位置 95 m","95","以 4 m/s 匀速后退","-4");
motionReach("m3_cp_04","compositional","戌由 2 m 位置起步，以 6 m/s 匀速前进；到达 50 m 时需要多久？","戌由 2 m 位置起步，以 6 m/s 匀速前进","由 2 m 位置","2","以 6 m/s 匀速前进","6","到达 50 m","50");
// Motion: two unsupported cases.
motionOvertakeUnsupported("m3_un_01","甲从位置 2 m 出发，以 4 m/s 匀速前进；乙从位置 18 m 出发，以 4 m/s 同向前进。问甲何时追上乙？","甲从位置 2 m 出发，以 4 m/s 匀速前进","乙从位置 18 m 出发，以 4 m/s 同向前进","2","4","18","4");
{
 const id="m3_un_02", statement="甲从位置 16 m 出发，以 -3 m/s 匀速后退。问甲何时到达位置 34 m？", clause="甲从位置 16 m 出发，以 -3 m/s 匀速后退";
 const facts=[fact(statement,`${id}_x0`,"initial","16","m","位置 16 m"),fact(statement,`${id}_v`,"velocity","-3","m/s","以 -3 m/s 匀速后退"),fact(statement,`${id}_target`,"target","34","m","位置 34 m")];
 const golden=base(id,"motion1d",statement,[{id:"A",kind:"body",props:{capability_id:"motion1d.constant_velocity",initial_position:`math:fact:${id}_x0`,segments:[{velocity:`math:fact:${id}_v`}]},provenance:sp(statement,clause)}],facts,[{goalId:"g_reach",capabilityId:"motion1d.reach_event",inputs:["entity:A",`fact:${id}_target`]}]);
 addCase(id,"motion1d","unsupported",statement,"ENGINE_UNSUPPORTED",golden);
}
// Motion: two known-limitation expected-rejects; sign exists only in the shared
// relational clause, never in each body's local direction phrase.
motionKnown("m3_kl_01","两艘渡船相向而行：甲从位置 -9 m 出发，以 3 m/s 驶出；乙从位置 9 m 出发，以 3 m/s 驶出。何时相遇？","甲从位置 -9 m 出发，以 3 m/s 驶出","乙从位置 9 m 出发，以 3 m/s 驶出","位置 -9 m","-9","以 3 m/s 驶出","3","位置 9 m","9","以 3 m/s 驶出","3");
motionKnown("m3_kl_02","两列检修车相向移动：甲车从位置 -12 m 以 4 m/s 出发；乙车从位置 12 m 以 4 m/s 出发。求相遇时刻。","甲车从位置 -12 m 以 4 m/s 出发","乙车从位置 12 m 以 4 m/s 出发","位置 -12 m","-12","以 4 m/s 出发","4","位置 12 m","12","以 4 m/s 出发","4");
// Motion: two harder-repair/provenance cases, supported with explicit local directions.


// Function2D expression/entity helpers. Goldens use explicit hand-authored AST
// constructors above; source expression strings are independently audited by G20.
function eqCase(id:string,category:string,statement:string,exprText:string,variable:string,lhs:any,rhs:any=zero,challengeType?:string,expected="COMPILE_OK") {
 const entity={id:"EQ",kind:"equation",props:{capability_id:"function2d.solve_equation",variable,lhs,rhs},provenance:sp(statement,exprText)};
 addCase(id,"function2d",category,statement,expected,base(id,"function2d",statement,[entity],[],[{goalId:"g_solve",capabilityId:"function2d.solve_equation",inputs:["entity:EQ"]}]),challengeType);
}
function functionZeros(id:string,category:string,statement:string,name:string,variable:string,declText:string,body:any,whole?:string,challengeType?:string) {
 const endPhrase=whole??statement.replace(/[。！？?]+$/u,"");
 const fn={id:`func_${name}`,kind:"function",label:name,props:{capability_id:"function2d.expression_curve",variable,expr:body},provenance:sp(statement,declText)};
 const eq={id:"EQ",kind:"equation",props:{capability_id:"function2d.solve_equation",variable,lhs:body,rhs:zero},provenance:sp(statement,endPhrase)};
 addCase(id,"function2d",category,statement,"COMPILE_OK",base(id,"function2d",statement,[eq,fn],[],[{goalId:"g_solve",capabilityId:"function2d.solve_equation",inputs:["entity:EQ"]}]),challengeType);
}
function functionMulti(id:string,statement:string,name:string,variable:string,declText:string,body:any,declGoalText:string,eqText:string,eqVar:string,eqLhs:any,eqRhs:any,challengeType:string) {
 const fn={id:`func_${name}`,kind:"function",label:name,props:{capability_id:"function2d.expression_curve",variable,expr:body},provenance:sp(statement,declText)};
 const zeroEq={id:"EQ_DECL",kind:"equation",props:{capability_id:"function2d.solve_equation",variable,lhs:body,rhs:zero},provenance:sp(statement,declGoalText)};
 const explicitEq={id:"EQ_EXPLICIT",kind:"equation",props:{capability_id:"function2d.solve_equation",variable:eqVar,lhs:eqLhs,rhs:eqRhs},provenance:sp(statement,eqText)};
 addCase(id,"function2d","compositional",statement,"COMPILE_OK",base(id,"function2d",statement,[zeroEq,explicitEq,fn],[],[
  {goalId:"g_decl_zeros",capabilityId:"function2d.solve_equation",inputs:["entity:EQ_DECL"]},
  {goalId:"g_explicit_equation",capabilityId:"function2d.solve_equation",inputs:["entity:EQ_EXPLICIT"]}
 ]),challengeType);
}
// Function2D: 8 straightforward.
eqCase("f3_sf_01","straightforward","解方程：x + 7 = 19。","x + 7 = 19","x",A(S("x"),N(7)),N(19));
eqCase("f3_sf_02","straightforward","解方程：x - 8 = 4。","x - 8 = 4","x",Sub(S("x"),N(8)),N(4));
eqCase("f3_sf_03","straightforward","解方程：x^2 - 25 = 0，求全部实数解。","x^2 - 25 = 0","x",Sub(Pow(S("x"),2),N(25)),N(0),"expression-term-loss");
eqCase("f3_sf_04","straightforward","解方程：x^2 + 2x - 15 = 0。","x^2 + 2x - 15 = 0","x",Sub(A(Pow(S("x"),2),Mul(N(2),S("x"))),N(15)),N(0),"expression-term-loss");
eqCase("f3_sf_05","straightforward","解方程：3x = 27。","3x = 27","x",Mul(N(3),S("x")),N(27),"expression-term-loss");
eqCase("f3_sf_06","straightforward","解方程：5x - 10 = 0。","5x - 10 = 0","x",Sub(Mul(N(5),S("x")),N(10)),N(0),"expression-term-loss");
functionZeros("f3_sf_07","straightforward","求函数 a(t) = t^2 - 4 的所有零点。","a","t","a(t) = t^2 - 4",Sub(Pow(S("t"),2),N(4)),undefined,"declared-entity-completeness");
functionZeros("f3_sf_08","straightforward","求函数 b(y) = 3*y + 12 的所有零点。","b","y","b(y) = 3*y + 12",A(Mul(N(3),S("y")),N(12)),undefined,"declared-entity-completeness");
// 4 wording variants.
eqCase("f3_wd_01","wording","若 x + 11 = 20，x 是多少？","x + 11 = 20","x",A(S("x"),N(11)),N(20));
eqCase("f3_wd_02","wording","找出满足 4x - 3 = 9 的 x。","4x - 3 = 9","x",Sub(Mul(N(4),S("x")),N(3)),N(9));
eqCase("f3_wd_03","wording","方程 x^2 - 49 = 0 的全部实数解是什么？","x^2 - 49 = 0","x",Sub(Pow(S("x"),2),N(49)),N(0),"expression-term-loss");
eqCase("f3_wd_04","wording","x^2 + 7x + 10 = 0 有哪些实数解？","x^2 + 7x + 10 = 0","x",A(A(Pow(S("x"),2),Mul(N(7),S("x"))),N(10)),N(0),"expression-term-loss");
// 4 irrelevant cases; first two challenge grounded distractor precision.
eqCase("f3_ir_01","irrelevant","小明身高 140 厘米。解方程：x + 6 = 14。","x + 6 = 14","x",A(S("x"),N(6)),N(14),"irrelevant-grounded-distractor");
functionZeros("f3_ir_02","irrelevant","教室有 22 张桌子。求函数 c(x) = x^2 - 1 的所有零点。","c","x","c(x) = x^2 - 1",Sub(Pow(S("x"),2),N(1)),undefined,"irrelevant-grounded-distractor");
functionZeros("f3_ir_03","irrelevant","气温为 24 摄氏度。求函数 e(z) = z^2 - 144 的所有零点。","e","z","e(z) = z^2 - 144",Sub(Pow(S("z"),2),N(144)),undefined,"declared-entity-completeness");
functionZeros("f3_ir_04","irrelevant","一本书有 210 页。求函数 d(u) = u + 3 的所有零点。","d","u","d(u) = u + 3",A(S("u"),N(3)),undefined,"declared-entity-completeness");
// 4 compositional, including two challenge cases with both a function source
// declaration and a separate source equation (two independently testable G20s).
functionZeros("f3_cp_01","compositional","求函数 h(x) = 2x^2 - 18 的所有零点。","h","x","h(x) = 2x^2 - 18",Sub(Mul(N(2),Pow(S("x"),2)),N(18)),undefined,"declared-entity-completeness");
functionZeros("f3_cp_02","compositional","求函数 k(t) = t^2 + 5*t + 6 的所有零点。","k","t","k(t) = t^2 + 5*t + 6",A(A(Pow(S("t"),2),Mul(N(5),S("t"))),N(6)),undefined,"declared-entity-completeness");
functionMulti("f3_cp_03","求函数 m(u) = u^2 - 9 的零点；另解方程 z - 4 = 0。","m","u","m(u) = u^2 - 9",Sub(Pow(S("u"),2),N(9)),"求函数 m(u) = u^2 - 9 的零点","z - 4 = 0","z",Sub(S("z"),N(4)),N(0),"multi-finding-one-repair");
functionMulti("f3_cp_04","求函数 n(y) = 3*y + 6 的零点，并解方程 w + 8 = 0。","n","y","n(y) = 3*y + 6",A(Mul(N(3),S("y")),N(6)),"求函数 n(y) = 3*y + 6 的零点","w + 8 = 0","w",A(S("w"),N(8)),N(0),"multi-finding-one-repair");
// 2 unsupported exact solver cases (goldens are schema/semantic valid; engine
// refuses unsupported irrational-root solving on the frozen compiler surface).
eqCase("f3_un_01","unsupported","解方程：x^2 - 11 = 0，求全部实数解。","x^2 - 11 = 0","x",Sub(Pow(S("x"),2),N(11)),N(0),undefined,"ENGINE_UNSUPPORTED");
eqCase("f3_un_02","unsupported","求方程 x^2 - 19 = 0 的全部实数根。","x^2 - 19 = 0","x",Sub(Pow(S("x"),2),N(19)),N(0),undefined,"ENGINE_UNSUPPORTED");
// 2 harder repair; rational coefficients remain in the frozen AST subset.
eqCase("f3_hr_01","harder_repair","解方程：x/2 + 3 = 8。","x/2 + 3 = 8","x",A(Div(S("x"),N(2)),N(3)),N(8));
eqCase("f3_hr_02","harder_repair","解方程：3x/2 - 5 = 7。","3x/2 - 5 = 7","x",Sub(Div(Mul(N(3),S("x")),N(2)),N(5)),N(7));

// Categories and challenge contract audit.
const counts: Record<string,Record<string,number>> = {};
for (const c of out) { counts[c.domain] ??= {}; counts[c.domain][c.category] = (counts[c.domain][c.category] ?? 0)+1; }
if (out.length !== 72) throw new Error(`expected 72 cases, got ${out.length}`);
for (const domain of ["geometry2d","motion1d","function2d"]) {
  if (out.filter((c) => c.domain===domain).length !== 24) throw new Error(`${domain}: expected 24`);
  const expectedCats={straightforward:8,wording:4,irrelevant:4,compositional:4,unsupported:2,harder_repair:2};
  for (const [cat,n] of Object.entries(expectedCats)) if (counts[domain]?.[cat]!==n) throw new Error(`${domain}/${cat}: ${counts[domain]?.[cat]} != ${n}`);
}
const challengeCounts: Record<string,number> = {};
for (const c of out) if(c.challengeType) challengeCounts[c.challengeType]=(challengeCounts[c.challengeType]??0)+1;
for (const k of ["declared-entity-completeness","irrelevant-grounded-distractor","expression-term-loss","multi-finding-one-repair"]) if(challengeCounts[k]!==6) throw new Error(`challenge ${k}: ${challengeCounts[k]} != 6`);

// Programmatic golden audit: supported cases must pass all gates; unsupported
// must be clean engine refusals; known limitations must fail-closed on G19.
const audit:any[]=[];
for (const c of out) {
  const r=attemptCompile(JSON.parse(JSON.stringify(c.golden)),c.statement);
  let ok=false;
  if(c.expected==="COMPILE_OK") ok=r.ok;
  else if(c.expected==="ENGINE_UNSUPPORTED") ok=!r.ok&&r.engineUnsupported;
  else if(c.expected==="KNOWN_LIMITATION_EXPECTED_REJECT") ok=!r.ok&&!r.engineUnsupported&&r.errors.some((e:any)=>e.code==="E_PROVENANCE_GROUNDING");
  audit.push({id:c.id,expected:c.expected,ok,errors:r.errors.map((e:any)=>e.code)});
  if(!ok) console.log("GOLDEN_AUDIT_FAIL",c.id,c.expected,r.ok,r.engineUnsupported,JSON.stringify(r.errors.map((e:any)=>({code:e.code,path:e.path,message:e.message}))));
}
const fails=audit.filter((x)=>!x.ok);
console.log("case_count",out.length,"challenge_counts",JSON.stringify(challengeCounts),"category_counts",JSON.stringify(counts),"golden_audit",`${audit.length-fails.length}/${audit.length}`);
if(fails.length) throw new Error(`${fails.length} golden audits failed`);
const dir=path.join(ROOT,"fixtures","parser-bench-v3");
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,"cases.json"),JSON.stringify({version:3,cases:out},null,2)+"\n","utf8");
console.log("wrote",path.join(dir,"cases.json"));
