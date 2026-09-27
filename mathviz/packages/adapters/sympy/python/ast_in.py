# ExprAst (MathViz JSON) -> SymPy expression. EXPLICIT mapping only.
#
# Forbidden everywhere in this adapter: sympify(raw), eval(raw), parse_expr.
# An unknown node/op -> WorkerError(E_SCHEMA): the oracle fails closed on
# anything outside the frozen operator vocabulary, it never guesses.

import re

from sympy import (
    Add,
    Mul,
    Pow,
    Rational,
    Symbol,
    Integer,
    sin,
    cos,
    tan,
    asin,
    acos,
    atan,
    exp,
    log,
    sqrt,
    Abs,
)

_INT_RE = re.compile(r"^-?(0|[1-9][0-9]*)$")
_POS_RE = re.compile(r"^[1-9][0-9]*$")

BINARY_OPS = {"+", "-", "*", "/", "^"}
UNARY_OPS = {"neg", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "exp", "ln", "sqrt"}
ALLOWED_OPS = BINARY_OPS | UNARY_OPS

_SYMBOL_CACHE = {}


class WorkerError(Exception):
    def __init__(self, code, message):
        super(WorkerError, self).__init__(message)
        self.code = code


def sym(name):
    if not isinstance(name, str) or not name:
        raise WorkerError("E_SCHEMA", "sym node needs a non-empty name")
    # P4.1: every MathViz symbol denotes a REAL quantity (ExactNumber is
    # rational-only; function variables range over real domains; parameters
    # carry finite rational ranges). Declaring real=True lets solveset PROVE
    # that e.g. {a-1, a+1} is real (collapsing Intersection(..., Reals) to a
    # plain FiniteSet), while conditionally-real shapes like sqrt(-a) stay
    # unproven and must be refused downstream — they encode an unresolved
    # parameter condition (a <= 0), which P4 has no assumptions layer for.
    if name not in _SYMBOL_CACHE:
        _SYMBOL_CACHE[name] = Symbol(name, real=True)
    return _SYMBOL_CACHE[name]


def _exact_number(v):
    if not isinstance(v, dict):
        raise WorkerError("E_SCHEMA", "num value must be an object")
    kind = v.get("kind")
    if kind == "int":
        s = v.get("value")
        if not isinstance(s, str) or not _INT_RE.fullmatch(s):
            raise WorkerError("E_SCHEMA", "malformed int literal %r" % (s,))
        return Integer(int(s))
    if kind == "rational":
        p, q = v.get("p"), v.get("q")
        if not isinstance(p, str) or not isinstance(q, str) or not _INT_RE.fullmatch(p) or not _POS_RE.fullmatch(q):
            raise WorkerError("E_SCHEMA", "malformed rational p/q %r/%r" % (p, q))
        return Rational(int(p), int(q))
    if kind == "symbolic":
        expr = v.get("expr")
        if not isinstance(expr, dict):
            raise WorkerError("E_SCHEMA", "symbolic number needs an expr object")
        return ast_to_expr(expr)
    raise WorkerError("E_SCHEMA", "unsupported exact number kind %r" % (kind,))


def ast_to_expr(node):
    if not isinstance(node, dict):
        raise WorkerError("E_SCHEMA", "expression node must be an object")
    t = node.get("t")
    if t == "num":
        return _exact_number(node.get("v"))
    if t == "sym":
        return sym(node.get("name"))
    if t == "app":
        op = node.get("op")
        args = node.get("args")
        if not isinstance(args, list):
            raise WorkerError("E_SCHEMA", "app node needs an args list")
        if op not in ALLOWED_OPS:
            raise WorkerError("E_SCHEMA", "unknown operator %r" % (op,))
        built = [ast_to_expr(a) for a in args]
        if op in BINARY_OPS:
            if len(built) != 2:
                raise WorkerError("E_SCHEMA", "binary op %r needs exactly 2 args" % (op,))
            a, b = built
            # let sympy normalize (sort/flatten) — canonical form matters more
            # than preserving MathViz node order; solveset/simplify rely on it
            if op == "+":
                return a + b
            if op == "-":
                return a - b
            if op == "*":
                return a * b
            if op == "/":
                return a / b
            if op == "^":
                return a ** b
        if len(built) != 1:
            raise WorkerError("E_SCHEMA", "unary op %r needs exactly 1 arg" % (op,))
        (u,) = built
        if op == "neg":
            return -u
        if op == "abs":
            return Abs(u)
        if op == "sin":
            return sin(u)
        if op == "cos":
            return cos(u)
        if op == "tan":
            return tan(u)
        if op == "asin":
            return asin(u)
        if op == "acos":
            return acos(u)
        if op == "atan":
            return atan(u)
        if op == "exp":
            return exp(u)
        if op == "ln":
            return log(u)
        if op == "sqrt":
            return sqrt(u)
    raise WorkerError("E_SCHEMA", "unknown node tag %r" % (t,))
