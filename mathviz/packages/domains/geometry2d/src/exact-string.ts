// Minimal exact-expression string parser (P2 frozen grammar):
//   number | sqrt(...) | expr + expr | expr - expr | expr * expr | expr / expr | (expr)
// Numbers: integer or decimal (converted to exact rationals). Produces an
// ExprAst for the shared runtime evaluator — exact integers/rationals stay
// exact; sqrt goes down the deterministic numeric track. No variables.

import { makeRuntimeError } from "../../../runtime/src/errors";

type Ast = any;

const TOKEN_RE = /\s*(\d+(?:\.\d+)?|sqrt|[+\-*/()])/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    TOKEN_RE.lastIndex = i;
    const m = TOKEN_RE.exec(src);
    if (!m) {
      if (/\s/.test(src[i]!)) { i++; continue; }
      throw makeRuntimeError("E_SCHEMA", `exact-string parse error at '${src.slice(i)}' in '${src}'`);
    }
    out.push(m[1]!);
    i = TOKEN_RE.lastIndex;
  }
  return out;
}

function decimalToRational(s: string): { p: string; q: string } {
  if (!s.includes(".")) return { p: s, q: "1" };
  const [a, b = ""] = s.split(".");
  const p = (a || "0") + b;
  let q = "1";
  for (let i = 0; i < b.length; i++) q += "0";
  return { p: String(BigInt(p)), q: String(BigInt(q)) };
}

export function parseExactString(src: string): Ast {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const eat = (): string | undefined => tokens[pos++];

  function parseExpr(minPrec: number): Ast {
    let left = parseUnary();
    for (;;) {
      const op = peek();
      const prec = op === "+" || op === "-" ? 1 : op === "*" || op === "/" ? 2 : 0;
      if (!op || prec < minPrec || prec === 0) break;
      eat();
      const right = parseExpr(prec + 1);
      left = { t: "app", op, args: [left, right] };
    }
    return left;
  }

  function parseUnary(): Ast {
    const t = peek();
    if (t === "-") { eat(); return { t: "app", op: "neg", args: [parseUnary()] }; }
    if (t === "+") { eat(); return parseUnary(); }
    return parsePrimary();
  }

  function parsePrimary(): Ast {
    const t = eat();
    if (t === undefined) throw makeRuntimeError("E_SCHEMA", `exact-string ended unexpectedly: '${src}'`);
    if (/^\d/.test(t)) {
      const r = decimalToRational(t);
      return { t: "num", v: { kind: "rational", p: r.p, q: r.q } };
    }
    if (t === "sqrt") {
      if (eat() !== "(") throw makeRuntimeError("E_SCHEMA", `sqrt must be followed by '(' in '${src}'`);
      const inner = parseExpr(1);
      if (eat() !== ")") throw makeRuntimeError("E_SCHEMA", `missing ')' in '${src}'`);
      return { t: "app", op: "sqrt", args: [inner] };
    }
    if (t === "(") {
      const inner = parseExpr(1);
      if (eat() !== ")") throw makeRuntimeError("E_SCHEMA", `missing ')' in '${src}'`);
      return inner;
    }
    throw makeRuntimeError("E_SCHEMA", `unexpected token '${t}' in '${src}'`);
  }

  const ast = parseExpr(1);
  if (pos !== tokens.length) throw makeRuntimeError("E_SCHEMA", `trailing tokens in exact-string '${src}'`);
  return ast;
}
