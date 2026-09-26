# Oracle operations (P4 section 4): solveset / diff / substitution / simplify.
# lambdify() is NEVER used — the oracle produces FACTS, the MathViz ExprAst
# evaluator stays the runtime numeric evaluator (two independent tracks).
#
# Accepted result shapes ONLY (section 7): FiniteSet, single exact
# expression, finite extrema list. ConditionSet from a parametric solveset
# falls back to solve() (polynomial parametrics); anything non-finite
# (ImageSet / Interval / ComplexRegion / mixed Union) -> E_CAPABILITY_UNSUPPORTED.

from sympy import (
    S,
    Eq,
    FiniteSet,
    ConditionSet,
    ImageSet,
    Interval,
    Intersection,
    Union,
    Symbol,
    diff,
    simplify,
    solveset,
    solve,
)

from ast_in import WorkerError, ast_to_expr, sym
from ast_out import value, exact_number, expr_to_ast


def _var(payload, key="variable"):
    name = payload.get(key)
    if not isinstance(name, str) or not name:
        raise WorkerError("E_SCHEMA", "payload needs a '%s' symbol name" % key)
    return sym(name)


def op_ping(_payload):
    import sympy as sp

    return {"sympy_version": sp.__version__, "pinned": True}


def _is_pure_finite_set(sol):
    if isinstance(sol, FiniteSet):
        return True
    if isinstance(sol, Union):
        return all(_is_pure_finite_set(a) for a in sol.args)
    return False


def _finite_elements(sol):
    if isinstance(sol, FiniteSet):
        return list(sol)
    if isinstance(sol, Union) and _is_pure_finite_set(sol):
        values = []
        for part in sol.args:
            values.extend(_finite_elements(part))
        return values
    raise WorkerError("E_CAPABILITY_UNSUPPORTED", "not a finite set: %s" % (sol,))


def _finite_set(values):
    return {"kind": "finite_set", "values": [value(v) for v in values]}


def _solution_set(sol, variable, fallback_equation):
    """solveset result -> MathViz FiniteSolutionSet, fail-closed."""
    if sol is S.EmptySet:
        return _finite_set([])
    if _is_pure_finite_set(sol):
        values = _finite_elements(sol)
        # canonical deterministic order
        values = sorted(values, key=lambda v: (v.sort_key(), str(v)))
        return _finite_set(values)
    if isinstance(sol, Intersection):
        # parametric shape {a-1, a+1} ∩ Reals: accept when every non-Reals
        # part is a pure finite set (values may contain free parameters)
        parts = [p for p in sol.args if p is not S.Reals]
        if len(parts) + 1 == len(sol.args) and all(_is_pure_finite_set(p) for p in parts):
            values = []
            for p in parts:
                values.extend(p.args if isinstance(p, FiniteSet) else p)
            values = sorted(values, key=lambda v: (v.sort_key(), str(v)))
            return _finite_set(values)
    if isinstance(sol, ConditionSet):
        # parametric undecidable over Reals: solve() handles polynomial
        # parametrics exactly; if it cannot, we do not guess either
        try:
            sols = solve(fallback_equation, variable)
        except Exception:
            raise WorkerError("E_CAPABILITY_UNSUPPORTED", "parametric solution set not decidable: %s" % (sol,))
        if isinstance(sols, (list, tuple, set)):
            flat = []
            for s in sols:
                if isinstance(s, tuple):
                    raise WorkerError("E_CAPABILITY_UNSUPPORTED", "solution systems are out of P4 scope")
                flat.append(s)
            flat = sorted(flat, key=lambda v: (v.sort_key(), str(v)))
            return _finite_set(flat)
        raise WorkerError("E_CAPABILITY_UNSUPPORTED", "solve() returned %s" % type(sols).__name__)
    # ImageSet / Interval / ComplexRegion / anything else: refuse
    raise WorkerError("E_CAPABILITY_UNSUPPORTED", "solution set is not a finite simple set: %s" % (sol,))


def op_roots(payload):
    expr = ast_to_expr(payload.get("expr"))
    x = _var(payload)
    eq = Eq(expr, 0)
    sol = solveset(eq, x, S.Reals)
    return _solution_set(sol, x, eq)


def op_intersection(payload):
    f = ast_to_expr(payload.get("f"))
    g = ast_to_expr(payload.get("g"))
    x = _var(payload)
    eq = Eq(f - g, 0)
    sol = solveset(eq, x, S.Reals)
    return _solution_set(sol, x, eq)


def op_derivative(payload):
    expr = ast_to_expr(payload.get("expr"))
    x = _var(payload)
    return value(diff(expr, x))


def op_extremum(payload):
    expr = ast_to_expr(payload.get("expr"))
    x = _var(payload)
    d1 = diff(expr, x)
    d2 = diff(d1, x)
    eq = Eq(d1, 0)
    sol = solveset(eq, x, S.Reals)
    solset = _solution_set(sol, x, eq)
    points = []
    for v in solset["values"]:
        if v["kind"] in ("int", "rational"):
            xs = v
            xv = v
        elif v["kind"] == "symbolic":
            xs = v
            xv = v
        else:
            raise WorkerError("E_CAPABILITY_UNSUPPORTED", "extremum candidate %s unsupported" % (v,))
        # re-substitute through the AST to keep the exact symbolic form
        x_expr = ast_to_expr(xs["expr"]) if xs["kind"] == "symbolic" else _as_sympy_number(xs)
        y = expr.subs(x, x_expr)
        curv = d2.subs(x, x_expr)
        if curv.is_positive:
            kind = "min"
        elif curv.is_negative:
            kind = "max"
        else:
            kind = "flat"
        points.append({"x": value(x_expr), "y": value(y), "type": kind})
    return {"kind": "extrema_list", "points": points}


def _as_sympy_number(v):
    from sympy import Integer, Rational

    if v["kind"] == "int":
        return Integer(int(v["value"]))
    if v["kind"] == "rational":
        return Rational(int(v["p"]), int(v["q"]))
    raise WorkerError("E_SCHEMA", "expected numeric value")


def op_value_at(payload):
    expr = ast_to_expr(payload.get("expr"))
    x = _var(payload)
    at = payload.get("x")
    if at is None:
        raise WorkerError("E_SCHEMA", "value_at needs an 'x' ExactNumber")
    x_expr = _value_to_sympy(at)
    return value(expr.subs(x, x_expr))


def _value_to_sympy(v):
    if not isinstance(v, dict):
        raise WorkerError("E_SCHEMA", "value_at x must be an ExactNumber object")
    if v.get("kind") in ("int", "rational"):
        return _as_sympy_number(v)
    if v.get("kind") == "symbolic":
        return ast_to_expr(v.get("expr"))
    raise WorkerError("E_SCHEMA", "unsupported value kind %r" % (v.get("kind"),))


def op_solve_equation(payload):
    lhs = ast_to_expr(payload.get("lhs"))
    rhs = ast_to_expr(payload.get("rhs"))
    x = _var(payload)
    eq = Eq(lhs, rhs)
    sol = solveset(eq, x, S.Reals)
    return _solution_set(sol, x, eq)


def op_check_equal(payload):
    lhs = ast_to_expr(payload.get("lhs"))
    rhs = ast_to_expr(payload.get("rhs"))
    return {"equal": simplify(lhs - rhs) == 0}
