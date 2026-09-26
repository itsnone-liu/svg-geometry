# SymPy -> MathViz protocol values. NO Python repr strings ever cross the
# wire as data: everything converts back to ExactNumber / ExprAst /
# FiniteSolutionSet JSON (P4 task book section 6).

from sympy import (
    Add,
    Mul,
    Pow,
    Rational,
    Integer,
    Symbol,
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

from ast_in import WorkerError

# symbols with special numeric meaning in the MathViz evaluator
CONSTANT_SYMBOLS = {"pi": "pi", "E": "e"}


def exact_number(expr):
    """Number-like sympy object -> MathViz ExactNumber JSON."""
    if isinstance(expr, Integer):
        return {"kind": "int", "value": str(expr)}
    if isinstance(expr, Rational):
        return {"kind": "rational", "p": str(expr.p), "q": str(expr.q)}
    raise WorkerError("E_CAPABILITY_UNSUPPORTED", "value %s is not an exact rational" % (expr,))


def is_exact_number(expr):
    return isinstance(expr, (Integer, Rational))


def value(expr):
    """ExactNumber when numeric, symbolic ExprAst otherwise."""
    if is_exact_number(expr):
        return exact_number(expr)
    return {"kind": "symbolic", "expr": expr_to_ast(expr)}


def _fold(op, items):
    """Left-fold items into binary MathViz app nodes."""
    acc = items[0]
    for nxt in items[1:]:
        acc = {"t": "app", "op": op, "args": [acc, nxt]}
    return acc


def _num_int(n):
    return {"t": "num", "v": {"kind": "int", "value": str(n)}}


def _num_rat(p, q):
    return {"t": "num", "v": {"kind": "rational", "p": str(p), "q": str(q)}}


def expr_to_ast(expr):
    """SymPy expression -> MathViz ExprAst (frozen vocabulary only)."""
    if isinstance(expr, (Integer, Rational)):
        if expr == 0:
            return _num_int(0)
        if isinstance(expr, Integer):
            return _num_int(expr)
        if expr.q == 1:
            return _num_int(expr.p)
        return _num_rat(expr.p, expr.q)
    if isinstance(expr, Symbol):
        name = CONSTANT_SYMBOLS.get(expr.name, expr.name)
        return {"t": "sym", "name": name}
    if isinstance(expr, Add):
        args = list(expr.args)
        # split leading negative coefficient into a subtraction for readability
        if len(args) > 1 and args[0].could_extract_minus_sign():
            rest = args[1:]
            folded = _fold("+", [expr_to_ast(a) for a in rest])
            return {"t": "app", "op": "-", "args": [folded, expr_to_ast(-args[0])]}
        return _fold("+", [expr_to_ast(a) for a in args])
    if isinstance(expr, Mul):
        args = list(expr.args)
        if len(args) > 1 and args[0].could_extract_minus_sign():
            rest = args[1:]
            folded = _fold("*", [expr_to_ast(a) for a in rest])
            return {"t": "app", "op": "*", "args": [_num_int(-1), folded]}
        return _fold("*", [expr_to_ast(a) for a in args])
    if isinstance(expr, Pow):
        base, exponent = expr.args
        if exponent == Rational(1, 2):
            return {"t": "app", "op": "sqrt", "args": [expr_to_ast(base)]}
        return {"t": "app", "op": "^", "args": [expr_to_ast(base), expr_to_ast(exponent)]}
    if isinstance(expr, sin):
        return {"t": "app", "op": "sin", "args": [expr_to_ast(expr.args[0])]}
    if isinstance(expr, cos):
        return {"t": "app", "op": "cos", "args": [expr_to_ast(expr.args[0])]}
    if isinstance(expr, tan):
        return {"t": "app", "op": "tan", "args": [expr_to_ast(expr.args[0])]}
    if isinstance(expr, asin):
        return {"t": "app", "op": "asin", "args": [expr_to_ast(expr.args[0])]}
    if isinstance(expr, acos):
        return {"t": "app", "op": "acos", "args": [expr_to_ast(expr.args[0])]}
    if isinstance(expr, atan):
        return {"t": "app", "op": "atan", "args": [expr_to_ast(expr.args[0])]}
    if isinstance(expr, exp):
        return {"t": "app", "op": "exp", "args": [expr_to_ast(expr.args[0])]}
    if isinstance(expr, log):
        return {"t": "app", "op": "ln", "args": [expr_to_ast(expr.args[0])]}
    if isinstance(expr, Abs):
        return {"t": "app", "op": "abs", "args": [expr_to_ast(expr.args[0])]}
    raise WorkerError("E_CAPABILITY_UNSUPPORTED", "cannot express %s in the frozen MathViz vocabulary" % (expr,))
