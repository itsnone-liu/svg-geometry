// G20 — Source Semantic Fidelity verifier (P5.3).
//
// Bounded, domain-specific, deterministic, fail-closed — the same discipline
// as G19. G20 never does general NLP entailment. It answers three questions
// the P5.2 runs showed were silent:
//
//   G20-A  declared-entity completeness: an explicitly declared source entity
//          the goal depends on must be represented as its own entity of the
//          matching kind (first supported surface: Function2D `f(x) = ...`).
//   G20-B  bidirectional expression fidelity: G19 proves candidate tokens
//          exist in the source; G20-B proves source expressions are not
//          structurally lost (`x - 3 = 0` may not become `x = 0`).
//   G20-C  goal-relevance closure: every fact/entity must be reachable from
//          goal semantics or be a required source-declaration anchor
//          (ProblemSpec is the minimal closure, not full-text extraction).
//
// Outside the frozen subset (non-function2d expressions, unparsable math
// spans) G20 reports nothing — an unsupported verifier surface is not a
// passed check and never fabricates success.

export interface FidelityFinding {
  code: "E_SOURCE_COMPLETENESS" | "E_SOURCE_EXPRESSION_LOSS" | "E_SOURCE_IRRELEVANT";
  path: string;
  message: string;
  repair_hint: string;
}

export interface FidelityResult {
  // Number of declared entities the G20-A rule demanded (for metrics).
  declaredEntities: number;
  // Number of source expressions the G20-B rule demanded.
  sourceExpressions: number;
  findings: FidelityFinding[];
}

// ---------------------------------------------------------------------------
// Canonical AST form (shared by source parsing and candidate comparison).
// Mirrors the benchmark normalizer's semantics for the expression subset:
// rational-normalized numbers, commutative sorting, neutral-element dropping,
// subtraction as addition of a negation.
// ---------------------------------------------------------------------------

type Ast = any;

function bigGcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a || 1n;
}

function ratCanon(pRaw: string, qRaw?: string): string {
  let p = BigInt(pRaw), q = qRaw ? BigInt(qRaw) : 1n;
  if (q === 0n) return `n(#${pRaw}/${qRaw ?? "1"}#)`;
  if (q < 0n) { p = -p; q = -q; }
  const d = bigGcd(p, q);
  return `n(${p / d}/${q / d})`;
}

function negValue(v: any): any {
  if (!v || typeof v !== "object") return v;
  if (v.kind === "int") return { kind: "int", value: String(-BigInt(v.value)) };
  if (v.kind === "rational") return { kind: "rational", p: String(-BigInt(v.p)), q: v.q };
  return v;
}

function isNumZero(c: string): boolean { return c === "n(0/1)"; }
function isNumOne(c: string): boolean { return c === "n(1/1)"; }

export function numericRat(ast: Ast): [bigint, bigint] | null {
  if (!ast || typeof ast !== "object") return null;
  if (ast.t === "num") {
    const v = ast.v ?? ast.value;
    if (v?.kind === "int") return [BigInt(v.value), 1n];
    if (v?.kind === "rational") return [BigInt(v.p), BigInt(v.q)];
    return null;
  }
  if (ast.t === "app" && ast.args?.length === 2 && ["/", "*", "+", "-"].includes(ast.op)) {
    const a = numericRat(ast.args[0]), b = numericRat(ast.args[1]);
    if (!a || !b) return null;
    if (ast.op === "+") return [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
    if (ast.op === "-") return [a[0] * b[1] - b[0] * a[1], a[1] * b[1]];
    if (ast.op === "*") return [a[0] * b[0], a[1] * b[1]];
    if (ast.op === "/" && b[0] !== 0n) return [a[0] * b[1], a[1] * b[0]];
  }
  if (ast.t === "app" && ast.op === "neg") {
    const a = numericRat(ast.args?.[0]); return a ? [-a[0], a[1]] : null;
  }
  return null;
}

function canon(ast: Ast): string {
  if (!ast || typeof ast !== "object") return "?";
  const nr = numericRat(ast);
  if (nr) return ratCanon(String(nr[0]), String(nr[1]));
  if (ast.t === "num") {
    const v = ast.v ?? ast.value;
    if (!v || typeof v !== "object") return `n(?)`;
    if (v.kind === "int") return ratCanon(v.value);
    if (v.kind === "rational") return ratCanon(v.p, v.q);
    return `n(?)`;
  }
  if (ast.t === "sym") return `s(${ast.name})`;
  if (ast.t === "app") {
    const op = ast.op;
    const args: Ast[] = ast.args ?? [];
    if (op === "+") {
      const flat: Ast[] = [];
      const collect = (n: Ast) => { if (n?.t === "app" && n.op === "+") (n.args ?? []).forEach(collect); else flat.push(n); };
      args.forEach(collect);
      const parts = flat.map(canon).filter((c) => !isNumZero(c));
      if (parts.length === 0) return "n(0/1)";
      parts.sort();
      return `(+ ${parts.join(" ")})`;
    }
    if (op === "-") {
      // a - b  ->  a + neg(b)
      const [a, ...rest] = args;
      const negs = rest.map((b) => canon(negAst(b)));
      const parts = [canon(a), ...negs].filter((c) => !isNumZero(c));
      if (parts.length === 0) return "n(0/1)";
      parts.sort();
      return `(+ ${parts.join(" ")})`;
    }
    if (op === "*") {
      const parts = args.map(canon).filter((c) => !isNumOne(c));
      if (parts.some(isNumZero)) return "n(0/1)";
      if (parts.length === 0) return "n(1/1)";
      parts.sort();
      return `(* ${parts.join(" ")})`;
    }
    if (op === "neg") return `neg(${canon(args[0])})`;
    if (op === "/") return `(/ ${canon(args[0])} ${canon(args[1])})`;
    if (op === "^") return `(^ ${canon(args[0])} ${canon(args[1])})`;
    return `(${op} ${args.map(canon).join(" ")})`;
  }
  return "?";
}

function negAst(ast: Ast): Ast {
  if (!ast || typeof ast !== "object") return ast;
  if (ast.t === "num") return { t: "num", v: negValue(ast.v ?? ast.value) };
  if (ast.t === "app" && ast.op === "neg") return ast.args?.[0] ?? ast;
  return { t: "app", op: "neg", args: [ast] };
}

function eqCanon(lhs: Ast, rhs: Ast): string {
  return `${canon(lhs)}=${canon(rhs)}`;
}

function equationsEqual(l1: Ast, r1: Ast, l2: Ast, r2: Ast): boolean {
  const a = eqCanon(l1, r1), b = eqCanon(l2, r2);
  const [al, ar] = a.split("=");
  const [bl, br] = b.split("=");
  return (al === bl && ar === br) || (al === br && ar === bl);
}

// ---------------------------------------------------------------------------
// Deterministic source-expression parser for the frozen Function2D subset:
// integer / rational literals, single-letter symbols, + - * /, ^ with integer
// exponent, parentheses, unicode superscripts ² ³, implicit multiplication
// (2x, 3(x+1)), unary minus, and top-level `=`.
// ---------------------------------------------------------------------------

interface Tok { k: "num" | "sym" | "op"; s: string }

const SUPERS: Record<string, string> = { "²": "2", "³": "3" };

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (SUPERS[c]) {
      if (toks.length === 0) return null;
      const prev = toks[toks.length - 1];
      if (prev.k !== "num" && prev.k !== "sym" && prev.s !== ")") return null;
      toks.push({ k: "op", s: "^" });
      toks.push({ k: "num", s: SUPERS[c] });
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      toks.push({ k: "num", s: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      // single-letter symbols only; multi-letter runs are out of subset
      if (i + 1 < src.length && /[a-zA-Z]/.test(src[i + 1])) return null;
      toks.push({ k: "sym", s: c });
      i++;
      continue;
    }
    if (c === "−" || c === "－") { toks.push({ k: "op", s: "-" }); i++; continue; }
    if (c === "＋") { toks.push({ k: "op", s: "+" }); i++; continue; }
    if (c === "×" || c === "·") { toks.push({ k: "op", s: "*" }); i++; continue; }
    if (c === "÷") { toks.push({ k: "op", s: "/" }); i++; continue; }
    if ("+-*/^=()".includes(c)) { toks.push({ k: "op", s: c }); i++; continue; }
    return null; // any other character (., ;, etc.) is out of subset
  }
  return toks.length ? toks : null;
}

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok | undefined { return this.toks[this.p]; }
  eatOp(s: string): boolean { const t = this.peek(); if (t && t.k === "op" && t.s === s) { this.p++; return true; } return false; }
  parseExpr(): Ast | null {
    let lhs = this.parseTerm();
    if (!lhs) return null;
    for (;;) {
      if (this.eatOp("+")) { const r = this.parseTerm(); if (!r) return null; lhs = { t: "app", op: "+", args: [lhs, r] }; }
      else if (this.eatOp("-")) { const r = this.parseTerm(); if (!r) return null; lhs = { t: "app", op: "-", args: [lhs, r] }; }
      else return lhs;
    }
  }
  startsFactor(t: Tok | undefined): boolean {
    if (!t) return false;
    if (t.k === "num" || t.k === "sym") return true;
    return t.k === "op" && t.s === "(";
  }
  parseTerm(): Ast | null {
    let lhs = this.parseUnary();
    if (!lhs) return null;
    for (;;) {
      if (this.eatOp("*")) { const r = this.parseUnary(); if (!r) return null; lhs = { t: "app", op: "*", args: [lhs, r] }; }
      else if (this.eatOp("/")) { const r = this.parseUnary(); if (!r) return null; lhs = { t: "app", op: "/", args: [lhs, r] }; }
      else if (this.startsFactor(this.peek())) { const r = this.parseUnary(); if (!r) return null; lhs = { t: "app", op: "*", args: [lhs, r] }; } // implicit multiplication
      else return lhs;
    }
  }
  parseUnary(): Ast | null {
    if (this.eatOp("-")) { const r = this.parseUnary(); if (!r) return null; return negAst(r); }
    if (this.eatOp("+")) return this.parseUnary();
    return this.parsePower();
  }
  parsePower(): Ast | null {
    const base = this.parseAtom();
    if (!base) return null;
    if (this.eatOp("^")) {
      const t = this.peek();
      if (!t || t.k !== "num") return null; // integer exponents only
      this.p++;
      return { t: "app", op: "^", args: [base, { t: "num", v: { kind: "int", value: t.s } }] };
    }
    return base;
  }
  parseAtom(): Ast | null {
    const t = this.peek();
    if (!t) return null;
    if (t.k === "num") { this.p++; return { t: "num", v: { kind: "int", value: t.s } }; }
    if (t.k === "sym") { this.p++; return { t: "sym", name: t.s }; }
    if (t.k === "op" && t.s === "(") {
      this.p++;
      const e = this.parseExpr();
      if (!e || !this.eatOp(")")) return null;
      return e;
    }
    return null;
  }
  atEnd(): boolean { return this.p === this.toks.length; }
}

function parseExpression(src: string): Ast | null {
  const toks = tokenize(src);
  if (!toks) return null;
  const p = new Parser(toks);
  const e = p.parseExpr();
  return e && p.atEnd() ? e : null;
}

// ---------------------------------------------------------------------------
// Statement scanning: find maximal ASCII-math runs, split off English words,
// parse each chunk as either a named declaration `f(x) = body` or an equation
// `lhs = rhs`.
// ---------------------------------------------------------------------------

export interface SourceDeclaration { name: string; variable: string; body: Ast; start: number; end: number }
export interface SourceEquation { lhs: Ast; rhs: Ast; start: number; end: number }

function topLevelSplit(s: string, ch: string): [string, string] | null {
  let depth = 0;
  let idx = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ch && depth === 0) {
      if (idx >= 0) return null; // more than one top-level occurrence
      idx = i;
    }
  }
  if (idx <= 0 || idx === s.length - 1) return null;
  return [s.slice(0, idx), s.slice(idx + 1)];
}

function declShape(s: string): { name: string; variable: string } | null {
  const m = /^([A-Za-z])\(([A-Za-z])\)$/.exec(s.replace(/\s+/g, ""));
  return m ? { name: m[1], variable: m[2] } : null;
}

export function scanSourceMath(statement: string, domain: string): { declarations: SourceDeclaration[]; equations: SourceEquation[] } {
  const declarations: SourceDeclaration[] = [];
  const equations: SourceEquation[] = [];
  if (domain !== "function2d") return { declarations, equations }; // G20-B frozen subset
  // Include common unsupported math punctuation in the candidate chunk so a
  // decimal/inequality/absolute-value expression is rejected as one N/A span,
  // not accidentally truncated into a misleading supported prefix.
  const chunkRe = /[0-9A-Za-z+\-*/^=().<>|√≤≥×−\s\u00B2\u00B3]{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = chunkRe.exec(statement))) {
    const raw = m[0];
    if (!/[=+\-*/^\u00B2\u00B3]/.test(raw.replace(/\s/g, ""))) continue; // needs an operator
    // Strip English words: letter runs of length >= 2 not in call position.
    const stripped = raw.replace(/[A-Za-z]{2,}/g, (w, off) => {
      const after = raw.slice(off + w.length).match(/^\s*\(/);
      return after ? w : " ";
    });
    for (const part of stripped.split(/\s{2,}/)) {
      const cand = part.trim();
      if (cand.length < 3 || !cand.includes("=")) continue;
      const split = topLevelSplit(cand, "=");
      if (!split) continue;
      const [lhsS, rhsS] = split;
      const decl = declShape(lhsS);
      if (decl) {
        const body = parseExpression(rhsS);
        if (body) {
          const start = m.index + raw.indexOf(cand);
          declarations.push({ ...decl, body, start, end: start + cand.length });
        }
        continue;
      }
      const lhs = parseExpression(lhsS);
      const rhs = parseExpression(rhsS);
      if (lhs && rhs) {
        const start = m.index + raw.indexOf(cand);
        equations.push({ lhs, rhs, start, end: start + cand.length });
      }
    }
  }
  return { declarations, equations };
}

// ---------------------------------------------------------------------------
// G20 main entry. `spec` is a schema-valid ProblemSpec candidate; `statement`
// is the original problem text.
// ---------------------------------------------------------------------------

const HINT_COMPLETENESS =
  "An explicitly declared source entity that the requested goal depends on must be represented as its own entity of the matching kind, preserving its declaration (variable and expression) exactly. Representing an equivalent solving structure instead does not satisfy this contract.";
const HINT_EXPRESSION_LOSS =
  "Copy source expressions structurally and completely: both sides, every term, coefficient, and operator. Do not solve, rearrange, or simplify a source equation into a different equation, and do not drop declared function bodies.";
const HINT_IRRELEVANT =
  "ProblemSpec is the minimal closure of source semantics required by the requested goal: remove facts or entities that are not reachable from the goal's dependency graph, even if they are true, grounded, or explicitly stated.";

export function checkSourceFidelity(spec: any, statement: string): FidelityResult {
  const findings: FidelityFinding[] = [];
  const domain: string = spec?.domain ?? "";
  const goals: any[] = Array.isArray(spec?.goals) ? spec.goals : [];
  const entities: any[] = Array.isArray(spec?.entities) ? spec.entities : [];
  const facts: any[] = Array.isArray(spec?.source_facts) ? spec.source_facts : [];
  const parameters: any[] = Array.isArray(spec?.parameters) ? spec.parameters : [];
  const constraints: any[] = Array.isArray(spec?.constraints) ? spec.constraints : [];

  const { declarations, equations } = scanSourceMath(statement, domain);
  const goalUsesFunctionSemantics = domain === "function2d" && goals.some((g) => String(g?.capabilityId ?? "").startsWith("function2d.")) && /(?:函数|零点|实数根|函数值|图像)/u.test(statement);

  // --- G20-A: declared-entity completeness (Function2D first) ---
  const anchoredEntityIds = new Set<string>();
  let declaredCount = 0;
  for (const decl of declarations) {
    // A bare-constant body ("f(x) = 0") reads as an instruction, not a
    // declaration; outside this reliable subset.
    if (decl.body.t === "num" || !goalUsesFunctionSemantics) continue;
    declaredCount++;
    const match = entities.find((e) => {
      if (e?.kind !== "function") return false;
      const declaredName = String(e?.label ?? e?.id ?? "");
      if (declaredName !== decl.name) return false;
      if (String(e?.props?.variable ?? "") !== decl.variable) return false;
      if (canon(e?.props?.expr) !== canon(decl.body)) return false;
      const span = e?.provenance?.span;
      if (!span || typeof span.start !== "number" || typeof span.end !== "number") return false;
      return span.start < decl.end && decl.start < span.end;
    });
    if (!match) {
      findings.push({
        code: "E_SOURCE_COMPLETENESS",
        path: `/statement/declaration/${decl.start}-${decl.end}`,
        message: "an explicitly declared source entity required by the goal is not represented with its own matching entity",
        repair_hint: HINT_COMPLETENESS,
      });
    } else {
      anchoredEntityIds.add(match.id);
    }
  }

  // --- G20-B: bidirectional expression fidelity ---
  const equationEntities = entities.filter((e) => e?.kind === "equation");
  const functionEntities = entities.filter((e) => e?.kind === "function");
  let expressionCount = 0;
  for (const eq of equations) {
    expressionCount++;
    const ok = equationEntities.some((e) => equationsEqual(eq.lhs, eq.rhs, e?.props?.lhs, e?.props?.rhs))
      || functionEntities.some((e) => canon(e?.props?.expr) === eqCanon(eq.lhs, eq.rhs));
    if (!ok) {
      findings.push({
        code: "E_SOURCE_EXPRESSION_LOSS",
        path: `/statement/expression/${eq.start}-${eq.end}`,
        message: "a source equation is not structurally represented: its complete two-sided structure is missing from the spec",
        repair_hint: HINT_EXPRESSION_LOSS,
      });
    }
  }
  // Declared function bodies must also appear structurally (loss check for a
  // present-but-altered function entity).
  for (const decl of declarations) {
    if (decl.body.t === "num" || !goalUsesFunctionSemantics) continue;
    expressionCount++;
    const sameVar = functionEntities.filter((e) => String(e?.props?.variable ?? "") === decl.variable);
    if (sameVar.length > 0 && !sameVar.some((e) => canon(e?.props?.expr) === canon(decl.body))) {
      findings.push({
        code: "E_SOURCE_EXPRESSION_LOSS",
        path: `/statement/declaration/${decl.start}-${decl.end}`,
        message: "a declared function body is represented but its expression differs structurally from the declaration",
        repair_hint: HINT_EXPRESSION_LOSS,
      });
    }
  }

  // --- G20-C: goal-relevance closure ---
  const factIds = new Set(facts.map((f) => f?.fact_id).filter(Boolean));
  const entityIds = new Set(entities.map((e) => e?.id).filter(Boolean));
  const parameterIds = new Set(parameters.map((p) => p?.id).filter(Boolean));
  const allIds = new Set<string>([...factIds, ...entityIds, ...parameterIds]);
  const reachable = new Set<string>();
  const queue: string[] = [];

  const resolveRef = (s: string): string | null => {
    const m = /^(?:math:)?(fact|entity|param):(.+)$/.exec(s);
    if (m && allIds.has(m[2])) return m[2];
    if (allIds.has(s)) return s;
    return null;
  };

  for (const g of goals) {
    for (const inp of Array.isArray(g?.inputs) ? g.inputs : []) {
      if (typeof inp === "string") {
        const r = resolveRef(inp);
        if (r && !reachable.has(r)) { reachable.add(r); queue.push(r); }
      }
    }
  }
  for (const id of anchoredEntityIds) if (!reachable.has(id)) { reachable.add(id); queue.push(id); }

  const nodeById = new Map<string, any>();
  for (const f of facts) if (f?.fact_id) nodeById.set(f.fact_id, f);
  for (const e of entities) if (e?.id) nodeById.set(e.id, e);
  for (const p of parameters) if (p?.id) nodeById.set(p.id, p);
  for (let i = 0; i < constraints.length; i++) nodeById.set(`constraint:${i}`, constraints[i]);

  while (queue.length) {
    const id = queue.shift()!;
    const node = nodeById.get(id);
    if (!node) continue;
    const seen = new Set<string>();
    const walk = (v: any) => {
      if (v === null || v === undefined) return;
      if (typeof v === "string") {
        if (seen.has(v)) return;
        seen.add(v);
        const r = resolveRef(v);
        if (r && !reachable.has(r)) { reachable.add(r); queue.push(r); }
        return;
      }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === "object") { for (const val of Object.values(v)) walk(val); }
    };
    walk(node);
  }

  // Constraints are source semantics attached to their subject graph. A
  // constraint is relevant when at least one subject is reachable from the
  // goal; then all its subjects become part of the goal's dependency closure.
  const relevantConstraints = new Set<number>();
  for (let i = 0; i < constraints.length; i++) {
    const refs = (constraints[i]?.subject_refs ?? []).map((x: any) => typeof x === "string" ? resolveRef(x) : null).filter(Boolean) as string[];
    if (refs.some((id) => reachable.has(id))) {
      relevantConstraints.add(i);
      for (const id of refs) if (!reachable.has(id)) { reachable.add(id); queue.push(id); }
    }
  }
  // Complete any newly added subject/fact/entity/parameter edges.
  while (queue.length) {
    const id = queue.shift()!;
    const node = nodeById.get(id);
    if (!node) continue;
    const walk = (v: any) => {
      if (v === null || v === undefined) return;
      if (typeof v === "string") { const r = resolveRef(v); if (r && !reachable.has(r)) { reachable.add(r); queue.push(r); } return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === "object") for (const val of Object.values(v)) walk(val);
    };
    walk(node);
  }

  for (const f of facts) {
    if (f?.fact_id && !reachable.has(f.fact_id)) findings.push({ code: "E_SOURCE_IRRELEVANT", path: `/source_facts/${f.fact_id}`, message: "this source fact is not reachable from the goal dependency graph", repair_hint: HINT_IRRELEVANT });
  }
  for (const e of entities) {
    if (e?.id && !reachable.has(e.id)) findings.push({ code: "E_SOURCE_IRRELEVANT", path: `/entities/${e.id}`, message: "this entity is not reachable from the goal dependency graph", repair_hint: HINT_IRRELEVANT });
  }
  for (const p of parameters) {
    if (p?.id && !reachable.has(p.id)) findings.push({ code: "E_SOURCE_IRRELEVANT", path: `/parameters/${p.id}`, message: "this parameter is not reachable from the goal dependency graph", repair_hint: HINT_IRRELEVANT });
  }
  for (let i = 0; i < constraints.length; i++) {
    if (!relevantConstraints.has(i)) findings.push({ code: "E_SOURCE_IRRELEVANT", path: `/constraints/${i}`, message: "this constraint is not attached to a goal-reachable source entity or fact", repair_hint: HINT_IRRELEVANT });
  }

  return { declaredEntities: declaredCount, sourceExpressions: expressionCount, findings };
}
