// Semantic-normalized ProblemSpec comparison (P5.1 §26): two specs are the
// same compilation of a problem when their NORMALIZED canonical forms are
// byte-identical. Normalization is deliberately conservative — it only
// removes freedoms the schema already permits:
//
//   1. stable renaming: entities/facts/parameters/goals -> e#/f#/p#/g# by
//      first-appearance order, with all references rewritten
//   2. exact-number normalization: {int} and {rational q=1} unify to a
//      reduced rational form, everywhere including AST literals
//   3. AST canonicalization: flatten nested +/*, drop neutral terms (+0,
//      *1), sort commutative operands by canonical serialization
//   4. unit normalization (motion1d only, exact rational): km->m, h->s,
//      km/h->m/s
//
// Anything semantic (entity set, facts, spans, goals, capabilities) must
// match exactly — a hallucinated fact or an invented span still fails.
// (AST symbol names are NOT renamed: the benchmark convention pins the
// variable to x, so parameter-free specs compare exactly; that keeps the
// normalizer small and total.)

import { canonicalSerialize } from "../../contracts/src/serialize";
import { rat, mul, type Rat } from "../../domains/motion1d/src/rational";

// ---- exact numbers ----

function ratOf(v: any): Rat | null {
  try {
    if (v?.kind === "int") return rat(BigInt(v.value), 1n);
    if (v?.kind === "rational") return rat(BigInt(v.p), BigInt(v.q));
  } catch {
    /* fallthrough */
  }
  return null; // symbolic / malformed: identity
}

function normalizeNumber(v: any): any {
  const r = ratOf(v);
  if (!r) return v;
  return { kind: "rational", p: r.p.toString(), q: r.q.toString() };
}

// ---- AST canonicalization ----

function canonAst(ast: any): any {
  if (!ast || typeof ast !== "object") return ast;
  if (ast.t === "num") return { t: "num", v: normalizeNumber(ast.v) };
  if (ast.t === "sym") return { t: "sym", name: ast.name };
  if (ast.t === "app" && Array.isArray(ast.args)) {
    let args = ast.args.map(canonAst);
    if (ast.op === "+" || ast.op === "*") {
      // flatten nested same-op applications
      const flat: any[] = [];
      const walk = (n: any) => {
        if (n?.t === "app" && n.op === ast.op && Array.isArray(n.args)) n.args.forEach(walk);
        else flat.push(n);
      };
      args.forEach(walk);
      // drop neutral operands: x+0, x*1
      const neutral = ast.op === "+"
        ? (n: any) => n?.t === "num" && (n.v as any)?.kind === "rational" && (n.v as any).p === "0"
        : (n: any) => n?.t === "num" && (n.v as any)?.kind === "rational" && (n.v as any).p === (n.v as any).q;
      args = flat.filter((n) => !neutral(n));
      if (args.length === 0) return { t: "num", v: { kind: "rational", p: "0", q: "1" } };
      if (args.length === 1) return args[0];
      args.sort((a: any, b: any) => (canonicalSerialize(a) < canonicalSerialize(b) ? -1 : 1));
    }
    return { t: "app", op: ast.op, args };
  }
  return ast;
}

// ---- unit normalization (exact, motion1d) ----

const UNIT_SCALE: Record<string, { factor: Rat; to: string }> = {
  km: { factor: rat(1000n), to: "m" },
  h: { factor: rat(3600n), to: "s" },
  "km/h": { factor: rat(5n, 18n), to: "m/s" }
};

function normalizeFactUnit(fact: any): any {
  // exact-number normalization applies at the fact level too (int vs
  // rational q=1 are the same number), not just inside AST literals
  const value = normalizeNumber(fact?.value);
  const conv = UNIT_SCALE[fact?.unit];
  if (!conv) return { ...fact, value };
  const r = ratOf(value);
  if (!r) return { ...fact, value }; // symbolic: leave untouched
  const scaled = mul(r, conv.factor);
  return { ...fact, unit: conv.to, value: { kind: "rational", p: scaled.p.toString(), q: scaled.q.toString() } };
}

// ---- stable renaming ----

function renameAll(spec: any): any {
  const entMap = new Map<string, string>();
  const factMap = new Map<string, string>();
  const paramMap = new Map<string, string>();
  const goalMap = new Map<string, string>();
  const mapOf = (m: Map<string, string>, prefix: string) => (id: string) => {
    if (!m.has(id)) m.set(id, `${prefix}${m.size + 1}`);
    return m.get(id)!;
  };
  const e = mapOf(entMap, "e"), f = mapOf(factMap, "f"), p = mapOf(paramMap, "p"), g = mapOf(goalMap, "g");

  const factRef = (s: string) => `math:fact:${f(s.replace(/^math:fact:/, ""))}`;
  const paramRef = (s: string) => `math:param:${p(s.replace(/^math:param:/, ""))}`;
  const inputRef = (s: string) => {
    const m = /^(entity|fact|param):(.+)$/.exec(s);
    if (!m) return s;
    if (m[1] === "entity") return `entity:${e(m[2]!)}`;
    if (m[1] === "fact") return `fact:${f(m[2]!)}`;
    return `param:${p(m[2]!)}`;
  };

  const out: any = { ...spec };
  out.problemId = "normalized";
  out.parameters = (spec.parameters ?? []).map((x: any) => ({ ...x, id: p(x.id) }));
  out.source_facts = (spec.source_facts ?? []).map((x: any) => normalizeFactUnit({ ...x, fact_id: f(x.fact_id) }));
  out.entities = (spec.entities ?? []).map((x: any) => {
    const props = { ...x.props };
    if (typeof props.a === "string") props.a = e(props.a);
    if (typeof props.b === "string") props.b = e(props.b);
    if (typeof props.center === "string") props.center = e(props.center);
    if (typeof props.initial_position === "string") props.initial_position = factRef(props.initial_position);
    if (Array.isArray(props.segments)) {
      props.segments = props.segments.map((s: any) => ({
        ...s,
        start: typeof s.start === "string" ? factRef(s.start) : s.start,
        end: typeof s.end === "string" ? factRef(s.end) : s.end,
        velocity: typeof s.velocity === "string" ? factRef(s.velocity) : s.velocity,
        start_position: typeof s.start_position === "string" ? factRef(s.start_position) : s.start_position
      }));
    }
    if (props.parameter_bindings) {
      const nb: any = {};
      for (const [k, v] of Object.entries(props.parameter_bindings)) {
        nb[p(k)] = typeof v === "string" && v.startsWith("math:param:") ? paramRef(v) : v;
      }
      props.parameter_bindings = nb;
    }
    if (props.expr) props.expr = canonAst(props.expr);
    if (props.lhs) props.lhs = canonAst(props.lhs);
    if (props.rhs) props.rhs = canonAst(props.rhs);
    return { ...x, id: e(x.id), props };
  });
  out.constraints = (spec.constraints ?? []).map((c: any) => ({ ...c, subject_refs: (c.subject_refs ?? []).map(inputRef) }));
  out.goals = (spec.goals ?? []).map((x: any) => ({ ...x, goalId: g(x.goalId), inputs: (x.inputs ?? []).map(inputRef) }));
  return out;
}

/** Canonical key of a normalized spec (stable JSON, sorted keys). */
export function normalizedKey(spec: any): string {
  return canonicalSerialize(renameAll(spec));
}

/** Semantic equality under the conservative normalization above. */
export function semanticEqual(a: any, b: any): boolean {
  return normalizedKey(a) === normalizedKey(b);
}
