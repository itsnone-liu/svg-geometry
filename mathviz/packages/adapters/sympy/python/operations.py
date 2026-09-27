# Oracle operations (P4 section 4): solveset / diff / substitution / simplify.
# lambdify() is NEVER used — the oracle produces FACTS, the MathViz ExprAst
# evaluator stays the runtime numeric evaluator (two independent tracks).
#
# Accepted result shapes ONLY (P4.1 frozen, fail-closed): FiniteSet, finite
# Union of FiniteSets, FiniteSet ∩ Reals. ConditionSet (parametric/conditional
# solutions) is REFUSED — no solve() fallback, because real-solution
# completeness may depend on unresolved parameter conditions (e.g. x^2+a=0
# needs a<=0), which P4 has no assumptions layer for. ImageSet / Interval /
# ComplexRegion / anything else -> E_CAPABILITY_UNSUPPORTED. A future
# ConditionalSolutionSet contract is the only sanctioned way to lift this.

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


def _require_provably_real(values):
    """Fail-closed (P4.1): every accepted solution must be PROVABLY real.
    An element whose reality depends on an unresolved parameter condition
    (sqrt(-a) needs a <= 0) is refused, not guessed."""
    bad = [v for v in values if v.is_real is not True]
    if bad:
        raise WorkerError(
            "E_CAPABILITY_UNSUPPORTED",
            "conditional real membership refused (not provably real: %s)"
            % ", ".join(str(v) for v in bad),
        )


def _solution_set(sol, variable):
    """solveset result -> MathViz FiniteSolutionSet, fail-closed (P4.1)."""
    if sol is S.EmptySet:
        return _finite_set([])
    if _is_pure_finite_set(sol):
        values = _finite_elements(sol)
        _require_provably_real(values)
        # canonical deterministic order
        values = sorted(values, key=lambda v: (v.sort_key(), str(v)))
        return _finite_set(values)
    if isinstance(sol, Intersection):
        # FiniteSet ∩ Reals: accept ONLY when every element is PROVABLY real
        # (el.is_real is True). With real=True symbols, provably-real finite
        # sets usually collapse to a plain FiniteSet already; a surviving
        # Intersection with an unprovable element (e.g. sqrt(-a)) encodes an
        # unresolved parameter condition (a <= 0) — refuse it, never guess.
        parts = [p for p in sol.args if p is not S.Reals]
        if len(parts) + 1 == len(sol.args) and all(_is_pure_finite_set(p) for p in parts):
            values = []
            for p in parts:
                values.extend(p.args if isinstance(p, FiniteSet) else p)
            _require_provably_real(values)
            values = sorted(values, key=lambda v: (v.sort_key(), str(v)))
            return _finite_set(values)
    if isinstance(sol, ConditionSet):
        # P4.1: NO solve() fallback. A ConditionSet means real-solution
        # membership depends on unresolved conditions (typically parameter
        # domains); guessing answers here would freeze unproven completeness.
        raise WorkerError(
            "E_CAPABILITY_UNSUPPORTED",
            "parametric/conditional solution set refused (ConditionSet): %s" % (sol,),
        )
    # ImageSet / Interval / ComplexRegion / anything else: refuse
    raise WorkerError("E_CAPABILITY_UNSUPPORTED", "solution set is not a finite simple set: %s" % (sol,))


def op_roots(payload):
    expr = ast_to_expr(payload.get("expr"))
    x = _var(payload)
    eq = Eq(expr, 0)
    sol = solveset(eq, x, S.Reals)
    return _solution_set(sol, x)


def op_intersection(payload):
    f = ast_to_expr(payload.get("f"))
    g = ast_to_expr(payload.get("g"))
    x = _var(payload)
    eq = Eq(f - g, 0)
    sol = solveset(eq, x, S.Reals)
    return _solution_set(sol, x)


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
    solset = _solution_set(sol, x)
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
        # P4.1 frozen classification: second-derivative sign ONLY.
        #   f''(x*) > 0 -> min; f''(x*) < 0 -> max
        #   f''(x*) == 0 / unknown (symbolic, parameter-dependent) is NOT a
        # classification: x^4 has a minimum at 0 while x^3 has no extremum
        # there, both with f''=0. Without higher-order/neighbourhood sign
        # analysis we refuse instead of emitting a fake "flat" verdict.
        if curv.is_positive:
            kind = "min"
        elif curv.is_negative:
            kind = "max"
        else:
            raise WorkerError(
                "E_CAPABILITY_UNSUPPORTED",
                "extremum classification inconclusive at x=%s (f''=%s; no higher-order analysis in P4)"
                % (x_expr, curv),
            )
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
    return _solution_set(sol, x)


def op_check_equal(payload):
    lhs = ast_to_expr(payload.get("lhs"))
    rhs = ast_to_expr(payload.get("rhs"))
    return {"equal": simplify(lhs - rhs) == 0}
