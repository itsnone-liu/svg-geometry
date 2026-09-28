import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'fixtures', 'parser-bench-v4');
fs.mkdirSync(outDir, { recursive: true });
const n = (v) => ({ t:'num', v:{kind:'int', value:String(v)} });
const s = (name) => ({ t:'sym', name });
const a = (op, ...args) => ({ t:'app', op, args });
const mul = (v,x) => a('*', n(v), s(x));
const add = (x,y) => a('+',x,y);
const sub = (x,y) => a('-',x,y);
const sq = (x) => a('^',s(x),n(2));
const span = (statement, text) => { const start=statement.indexOf(text); if(start<0) throw new Error(`span missing: ${text}`); return {kind:'problem_text',span:{text,start,end:start+text.length}}; };
const base = (id,domain,statement,entities,source_facts,goals) => ({schemaVersion:'mathviz.problemspec/v1',problemId:id,domain,statement,entities,source_facts,goals});
const functionDual = (i, mode='linear') => {
  const names=['p','q','r','s','u','v','w','z']; const vars=['x','t','y','m'];
  const name=names[i%names.length], variable=vars[i%vars.length];
  let expr, body;
  if(mode==='unsupported'){ const roots=[2,3,5,6,7,10]; const c=roots[i%roots.length]; expr=sub(sq(variable),n(c)); body=`${variable}^2 - ${c}`; }
  else if(mode==='fraction'){ const c=2+i; expr=add(a('/',s(variable),n(2)),n(c)); body=`${variable}/2 + ${c}`; }
  else if(mode==='quadratic'){ const r=1+(i%4), q=3+(i%5), sum=r+q, product=r*q; expr=add(sub(sq(variable),mul(sum,variable)),n(product)); body=`${variable}^2 - ${sum}*${variable} + ${product}`; }
  else { const coef=2+i, constant=3+i; expr=sub(mul(coef,variable),n(constant)); body=`${coef}*${variable} - ${constant}`; }
  const declaration=`${name}(${variable}) = ${body}`;
  const statement=`定义 ${declaration}，求 ${name}(${variable}) 的零点。`;
  const fn={id:`fn_${i}`,kind:'function',label:name,props:{capability_id:'function2d.expression_curve',variable,expr},provenance:span(statement,declaration)};
  const eq={id:`eq_${i}`,kind:'equation',props:{capability_id:'function2d.solve_equation',variable,lhs:expr,rhs:n(0)},provenance:{kind:'problem_text',span:{text:statement,start:0,end:statement.length}}};
  return base(`v4_f_${String(i+1).padStart(2,'0')}`,'function2d',statement,[fn,eq],[],[{goalId:`solve_${i}`,capabilityId:'function2d.solve_equation',inputs:[`entity:${eq.id}`]}]);
};
const functionEquation = (i) => {
  const variable=['x','t','y','m'][i%4], coef=i+2, constant=i+5;
  const statement=`解方程 ${coef}*${variable} - ${constant} = 0。`, text=`${coef}*${variable} - ${constant} = 0`;
  const eq={id:`eq_${i}`,kind:'equation',props:{capability_id:'function2d.solve_equation',variable,lhs:sub(mul(coef,variable),n(constant)),rhs:n(0)},provenance:span(statement,text)};
  return base(`v4_f_${String(i+1).padStart(2,'0')}`,'function2d',statement,[eq],[],[{goalId:`solve_${i}`,capabilityId:'function2d.solve_equation',inputs:[`entity:${eq.id}`]}]);
};
const geometry = (i) => {
  const x1=i%7,y1=(i*2)%9,x2=x1+3,y2=y1+4,A=String.fromCharCode(65+i%20),B=String.fromCharCode(75+i%10);
  const x1Text=i<2?'sqrt(2)':String(x1);
  const p1=i<2?`${A} 的坐标为 (sqrt(2), ${y1})`:`${A}(${x1Text}, ${y1})`,p2=i<2?`${B} 的坐标为 (${x2}, ${y2})`:`${B}(${x2}, ${y2})`,seg=`${A}${B}`;
  const statement=i<2?`点 ${A} 的坐标为 (sqrt(2), ${y1})，点 ${B} 的坐标为 (${x2}, ${y2})，求线段 ${seg} 的长度。`:`平面上有点 ${p1} 和点 ${p2}，求线段 ${seg} 的长度。`;
  const e1={id:`p${i}a`,kind:'point',label:A,props:{x:x1Text,y:String(y1)},provenance:span(statement,p1)};
  if(i<2) e1.provenance=span(statement,`点 ${A} 的坐标为 (sqrt(2), ${y1})`);
  const e2={id:`p${i}b`,kind:'point',label:B,props:{x:String(x2),y:String(y2)},provenance:span(statement,p2)};
  const es={id:`seg${i}`,kind:'segment',label:seg,props:{a:e1.id,b:e2.id},provenance:span(statement,`线段 ${seg}`)};
  return base(`v4_g_${String(i+1).padStart(2,'0')}`,'geometry2d',statement,[e1,e2,es],[],[{goalId:`len${i}`,capabilityId:'geometry2d.derive_length',inputs:[`entity:${es.id}`]}]);
};
const motion = (i) => {
  const impossible=i<2, t=3+i%5,X=20+i,va=impossible?2:2+i%4,vb=impossible?2:1+i%3; // first two are explicit no-event declarations
  const xA=impossible?0:X-va*t,xB=impossible?10:X-vb*t;
  const statement=`甲初始位于 ${xA} m 处。甲以 ${va} m/s 匀速前进。乙初始位于 ${xB} m 处。乙以 ${vb} m/s 匀速前进。求二者何时相遇？`;
  const fact=(id,name,value,unit,text)=>({fact_id:id,name,unit,value:{kind:'int',value:String(value)},provenance:span(statement,text)});
  const pAText=`甲初始位于 ${xA} m 处`, vAText=`甲以 ${va} m/s 匀速前进`, pBText=`乙初始位于 ${xB} m 处`, vBText=`乙以 ${vb} m/s 匀速前进`;
  const facts=[fact(`xA${i}`,'甲初始位置',xA,'m',pAText),fact(`vA${i}`,'甲速度',va,'m/s',vAText),fact(`xB${i}`,'乙初始位置',xB,'m',pBText),fact(`vB${i}`,'乙速度',vb,'m/s',vBText)];
  const body=(id,pos,vel,text)=>({id,kind:'body',props:{capability_id:'motion1d.constant_velocity',initial_position:`math:fact:${pos}`,segments:[{velocity:`math:fact:${vel}`}]},provenance:span(statement,text)});
  const ea=body(`bodyA${i}`,`xA${i}`,`vA${i}`,`${pAText}。${vAText}。`);
  const eb=body(`bodyB${i}`,`xB${i}`,`vB${i}`,`${pBText}。${vBText}。`);
  return base(`v4_m_${String(i+1).padStart(2,'0')}`,'motion1d',statement,[ea,eb],facts,[{goalId:`meet${i}`,capabilityId:'motion1d.meeting_event',inputs:[`entity:${ea.id}`,`entity:${eb.id}`]}]);
};
const cases=[];
for(let i=0;i<24;i++) cases.push(geometry(i));
for(let i=0;i<24;i++) cases.push(motion(i));
for(let i=0;i<24;i++) cases.push(i<15?functionDual(i,i<2?'unsupported':i===6?'fraction':i%2?'quadratic':'linear'):functionEquation(i));
const declarations=new Map();
for(const c of cases) declarations.set(c.problemId,{expected_class:'COMPILE_OK',tags:[]});
// The first two motion cases are explicit no-event declarations. Their equal
// speeds and separated starts make the meeting equation unsatisfiable.

// Six explicit engine refusals: irrational polynomial roots, with no parser-owned error.
for(const id of ['v4_g_01','v4_g_02']) declarations.set(id,{expected_class:'ENGINE_UNSUPPORTED',expected_stage:'compiler',expected_error:'E_CAPABILITY_UNSUPPORTED',tags:['geometry-unsupported-coordinate']});
for(const id of ['v4_m_01','v4_m_02']) declarations.set(id,{expected_class:'ENGINE_UNSUPPORTED',expected_stage:'compiler',expected_error:'E_MATH_CONSTRAINT',tags:['motion-no-legal-event']});
for(const id of ['v4_f_01','v4_f_02']) declarations.set(id,{expected_class:'ENGINE_UNSUPPORTED',expected_stage:'compiler',expected_error:'E_CAPABILITY_UNSUPPORTED',tags:['function-irrational-roots']});
// Two explicit G19 known limitations: structure is valid but provenance is intentionally bad.
for(const id of ['v4_f_03','v4_f_04']){
  const c=cases.find(x=>x.problemId===id);
  const eq=c.entities.find(e=>e.kind==='equation');
  const start=c.statement.indexOf('求');
  const bad=c.statement.slice(start, c.statement.length);
  eq.provenance={kind:'problem_text',span:{text:bad,start,end:start+bad.length}};
  declarations.set(id,{expected_class:'KNOWN_LIMITATION_EXPECTED_REJECT',expected_stage:'G19',expected_error:'E_PROVENANCE_GROUNDING',expected_failure_family:'function_zero_bad_provenance',tags:['known-limitation','g19-grounding']});
}
for(let i=0;i<cases.length;i++){
  const c=cases[i], d=declarations.get(c.problemId);
  c.category=['straightforward','wording','irrelevant','compositional'][i%4];
  c.challengeType=['declared-entity-completeness','irrelevant-grounded-distractor','expression-term-loss','multi-finding-one-repair'][i%4];
  c.declaration=d;
}
const entries=cases.map(c=>{const golden=structuredClone(c); delete golden.category;delete golden.challengeType;delete golden.declaration; return {id:c.problemId,domain:c.domain,category:c.category,challengeType:c.challengeType,statement:c.statement,...c.declaration,golden};});
for(const e of entries){ if(!e.expected_class) throw new Error(`${e.id}: missing expected_class`); if(e.expected_class!=='COMPILE_OK'&&!e.expected_error) throw new Error(`${e.id}: refusal missing expected_error`); }
fs.writeFileSync(path.join(outDir,'cases.json'),JSON.stringify({version:4,benchmark:'mathviz-parser-benchmark/v4',cases:entries},null,2)+'\n');
console.log(JSON.stringify({cases:entries.length,domains:Object.fromEntries(['geometry2d','motion1d','function2d'].map(d=>[d,entries.filter(c=>c.domain===d).length])),classes:Object.fromEntries(['COMPILE_OK','ENGINE_UNSUPPORTED','KNOWN_LIMITATION_EXPECTED_REJECT'].map(k=>[k,entries.filter(c=>c.expected_class===k).length]))},null,2));
