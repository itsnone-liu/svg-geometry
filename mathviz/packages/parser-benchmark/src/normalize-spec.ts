// P5.1a semantic normalization v2. This normalizer is intentionally a
// benchmark comparator, not an algebra prover. It canonicalizes entity/fact
// graphs independent of array order and identifier spelling, preserves core
// semantic payload, and excludes provenance from the core-semantic key (span
// accuracy is scored independently by the benchmark).
import { canonicalSerialize } from "../../contracts/src/serialize";
import { rat, mul, type Rat } from "../../domains/motion1d/src/rational";

function ratOf(v: any): Rat | null {
  try { if (v?.kind === "int") return rat(BigInt(v.value)); if (v?.kind === "rational") return rat(BigInt(v.p), BigInt(v.q)); } catch { /* malformed/symbolic */ }
  return null;
}
function exact(v: any): any {
  const r = ratOf(v);
  return r ? { kind: "rational", p: r.p.toString(), q: r.q.toString() } : v;
}
const UNIT_SCALE: Record<string, { factor: Rat; to: string }> = { km: { factor: rat(1000n), to: "m" }, h: { factor: rat(3600n), to: "s" }, "km/h": { factor: rat(5n, 18n), to: "m/s" } };
function normFact(f: any): any {
  let value = exact(f.value), unit = f.unit;
  const conv = UNIT_SCALE[unit];
  if (conv) { const r = ratOf(value); if (r) { const scaled = mul(r, conv.factor); value = exact({ kind: "rational", p: scaled.p.toString(), q: scaled.q.toString() }); unit = conv.to; } }
  const { provenance: _p, fact_id: _id, name: _name, ...rest } = f;
  return { ...rest, unit: unit ?? null, value };
}

function canonAst(node: any, symbols: Map<string,string> = new Map()): any {
  if (!node || typeof node !== "object") return node;
  if (node.t === "num") return { t: "num", v: exact(node.v) };
  if (node.t === "sym") return { t: "sym", name: symbols.get(node.name) ?? node.name };
  if (node.t !== "app" || !Array.isArray(node.args)) return node;
  let op = node.op, args = node.args.map((a:any)=>canonAst(a,symbols));
  if (op === "-") {
    if (args.length === 2) return canonAst({ t: "app", op: "+", args: [args[0], { t: "app", op: "neg", args: [args[1]] }] });
    return { t: "app", op, args };
  }
  if (op === "neg" && args.length === 1) {
    const a = args[0];
    if (a?.t === "app" && a.op === "neg" && a.args?.length === 1) return a.args[0];
    if (a?.t === "num") { const r = ratOf(a.v); if (r) return { t: "num", v: exact({ kind: "rational", p: (-r.p).toString(), q: r.q.toString() }) }; }
  }
  if (op === "+" || op === "*") {
    const flat: any[] = [];
    const walk = (x: any) => x?.t === "app" && x.op === op ? x.args.forEach(walk) : flat.push(x);
    args.forEach(walk);
    const neutral = op === "+" ? (x: any) => x?.t === "num" && ratOf(x.v)?.p === 0n : (x: any) => x?.t === "num" && ratOf(x.v)?.p === ratOf(x.v)?.q;
    args = flat.filter((x) => !neutral(x));
    if (!args.length) return op === "+" ? { t: "num", v: exact({ kind: "int", value: "0" }) } : { t: "num", v: exact({ kind: "int", value: "1" }) };
    if (args.length === 1) return args[0];
    args.sort((a: any, b: any) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  }
  return { t: "app", op, args };
}

/** Canonical graph labels by topology/refinement, not input array position. */
function canonicalGraph(spec: any): any {
  const entities = spec.entities ?? [];
  const facts = spec.source_facts ?? [];
  const params = spec.parameters ?? [];
  const eColors = new Map<string, string>();
  const fColors = new Map<string, string>();
  const pColors = new Map<string, string>();
  const factDescriptors = new Map(facts.map((f:any)=>[f.fact_id, canonicalSerialize(normFact(f))]));
  const entityBase = (e: any) => {
    const props = { ...(e.props ?? {}) };
    const refs: any = {};
    for (const k of ["a","b","center"]) if (typeof props[k] === "string") {
      const target=entities.find((x:any)=>x.id===props[k]);
      refs[k]=target?.kind==="point"?{kind:"point",x:target.props?.x,y:target.props?.y}:{targetKind:target?.kind??"missing"};
    }
    if (typeof props.initial_position === "string") refs.initial_position = factDescriptors.get(props.initial_position.replace(/^math:fact:/,"")) ?? "missing";
    if (Array.isArray(props.segments)) refs.segments = props.segments.map((s:any)=>({start:s.start ? factDescriptors.get(String(s.start).replace(/^math:fact:/,"")) : "time-origin:0",end:s.end ? factDescriptors.get(String(s.end).replace(/^math:fact:/,"")) : null,velocity:factDescriptors.get(String(s.velocity).replace(/^math:fact:/,"")) ?? "missing"}));
    delete props.a; delete props.b; delete props.center;
    delete props.initial_position; delete props.segments;
    if (props.expr) props.expr = canonAst(props.expr);
    if (props.lhs) props.lhs = canonAst(props.lhs);
    if (props.rhs) props.rhs = canonAst(props.rhs);
    if (e.kind === "equation" && props.lhs && props.rhs && canonicalSerialize(props.lhs).localeCompare(canonicalSerialize(props.rhs)) > 0) [props.lhs, props.rhs] = [props.rhs, props.lhs];
    const { provenance: _p, id: _id, label: _label, ...rest } = e;
    return canonicalSerialize({ ...rest, props, refs });
  };
  const factBase = (f: any) => canonicalSerialize(normFact(f));
  const assign = (items: any[], map: Map<string,string>, idKey: string, base: (x:any)=>string, prefix: string) => {
    const sorted = [...items].sort((a,b) => base(a).localeCompare(base(b)) || String(a[idKey]).localeCompare(String(b[idKey])));
    sorted.forEach((x,i) => map.set(x[idKey], `${prefix}${i+1}`));
  };
  assign(entities,eColors,"id",entityBase,"e");
  assign(facts,fColors,"fact_id",factBase,"f");
  assign(params,pColors,"id",(x)=>canonicalSerialize({min:exact(x.min),max:exact(x.max),default:exact(x.default),unit:x.unit}),"p");
  const ref = (s: any): any => {
    if (typeof s !== "string") return s;
    const m = /^(entity|fact|param):(.+)$/.exec(s);
    if (!m) return s;
    const map = m[1] === "entity" ? eColors : m[1] === "fact" ? fColors : pColors;
    return `${m[1]}:${map.get(m[2]!) ?? `?${m[2]}`}`;
  };
  const mathFact = (s: any) => typeof s === "string" ? s.replace(/^math:fact:(.+)$/, (_m,id) => `math:fact:${fColors.get(id) ?? `?${id}`}`) : s;
  const outEntities = entities.map((e: any) => {
    const props = { ...(e.props ?? {}) };
    if (props.a) props.a = eColors.get(props.a) ?? `?${props.a}`;
    if (props.b) props.b = eColors.get(props.b) ?? `?${props.b}`;
    if (props.center) props.center = eColors.get(props.center) ?? `?${props.center}`;
    if (props.initial_position) props.initial_position = mathFact(props.initial_position);
    if (Array.isArray(props.segments)) props.segments = props.segments.map((s: any) => ({ ...s, start: mathFact(s.start), end: mathFact(s.end), velocity: mathFact(s.velocity), start_position: mathFact(s.start_position) }));
    if (props.expr) props.expr = canonAst(props.expr);
    if (props.lhs) props.lhs = canonAst(props.lhs);
    if (props.rhs) props.rhs = canonAst(props.rhs);
    if (e.kind === "equation" && props.lhs && props.rhs && canonicalSerialize(props.lhs).localeCompare(canonicalSerialize(props.rhs)) > 0) [props.lhs, props.rhs] = [props.rhs, props.lhs];
    const { provenance: _p, id: _id, label: _label, ...rest } = e;
    return { ...rest, id: eColors.get(e.id), props };
  }).sort((a:any,b:any) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  const outFacts = facts.map((f:any) => ({ ...normFact(f), fact_id: fColors.get(f.fact_id) })).sort((a:any,b:any) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  const outParams = params.map((p:any) => ({ ...p, id: pColors.get(p.id), min: exact(p.min), max: exact(p.max), default: exact(p.default) })).sort((a:any,b:any)=>canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  const goals = (spec.goals ?? []).map((g:any) => ({ capabilityId:g.capabilityId, inputs:(g.inputs??[]).map(ref).sort() })).sort((a:any,b:any)=>canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  const constraints = (spec.constraints ?? []).map((c:any) => { const {provenance:_p,...r}=c; return {...r,subject_refs:(c.subject_refs??[]).map(ref).sort()}; }).sort((a:any,b:any)=>canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  return { domain: spec.domain, entities: outEntities, facts: outFacts, parameters: outParams, goals, constraints };
}

export function normalizedKey(spec: any): string { return canonicalSerialize(canonicalGraph(spec)); }
export function semanticEqual(a: any,b:any): boolean { return normalizedKey(a) === normalizedKey(b); }

/** Independently compare high-level semantic strata; provenance excluded. */
export function semanticLayers(spec: any): Record<string,string> {
  const graph = canonicalGraph(spec);
  const asts = (spec.entities??[]).filter((e:any)=>e.kind==="equation"||e.kind==="function").map((e:any)=>{
    let lhs=e.props?.lhs?canonAst(e.props.lhs):undefined, rhs=e.props?.rhs?canonAst(e.props.rhs):undefined;
    if(e.kind==="equation"&&lhs&&rhs&&canonicalSerialize(lhs).localeCompare(canonicalSerialize(rhs))>0)[lhs,rhs]=[rhs,lhs];
    return {kind:e.kind,variable:e.props?.variable,expr:e.props?.expr?canonAst(e.props.expr):undefined,lhs,rhs};
  }).sort((a:any,b:any)=>canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  const provenance = (spec.entities??[]).map((e:any)=>e.provenance?.span?.text??null).concat((spec.source_facts??[]).map((f:any)=>f.provenance?.span?.text??null)).sort();
  return {
    goal_semantics: canonicalSerialize(graph.goals),
    entity_graph: canonicalSerialize(graph.entities),
    numerical_facts: canonicalSerialize(graph.facts),
    expressions: canonicalSerialize(asts),
    provenance: canonicalSerialize(provenance)
  };
}
