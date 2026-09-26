# MathViz SymPy oracle worker (P4).
#
# SECURITY (frozen):
#   - stdin/stdout speak ONLY the JSON Lines protocol mathviz.sympy/v1
#   - every expression arrives as an ALREADY-VALIDATED MathViz ExprAst JSON
#     tree; this worker NEVER sympifies/evals raw strings
#   - debug/log output goes to stderr only; stdout stays protocol-clean
#   - sympy version is pinned == 1.14.0; anything else refuses to serve
#
# This process exists ONLY at compile/freeze time (G13 oracle). It is never
# part of the browser bundle, never part of per-frame evaluation.

import sys
import os
import json

# some interpreters (embedded/safe-path builds) do not put the script
# directory on sys.path — make sibling module imports explicit and portable
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

PINNED = "1.14.0"

import sympy as sp  # noqa: E402

from ast_in import ast_to_expr, WorkerError  # noqa: E402
from operations import (  # noqa: E402
    op_ping,
    op_roots,
    op_intersection,
    op_derivative,
    op_extremum,
    op_value_at,
    op_solve_equation,
    op_check_equal,
)

OPS = {
    "ping": op_ping,
    "roots": op_roots,
    "intersection": op_intersection,
    "derivative": op_derivative,
    "extremum": op_extremum,
    "value_at": op_value_at,
    "solve_equation": op_solve_equation,
    "check_equal": op_check_equal,
}


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":"), sort_keys=True) + "\n")
    sys.stdout.flush()


def handle(req):
    protocol = req.get("protocol")
    if sp.__version__ != PINNED:
        return {
            "protocol": "mathviz.sympy/v1",
            "request_id": req.get("request_id"),
            "ok": False,
            "error": {"code": "E_CAPABILITY_UNSUPPORTED", "message": "sympy %s != pinned %s" % (sp.__version__, PINNED)},
        }
    if protocol != "mathviz.sympy/v1":
        return {"ok": False, "error": {"code": "E_SCHEMA", "message": "unknown protocol '%s'" % protocol}}
    op = req.get("op")
    fn = OPS.get(op)
    if fn is None:
        return {"protocol": "mathviz.sympy/v1", "request_id": req.get("request_id"), "ok": False, "error": {"code": "E_CAPABILITY_UNSUPPORTED", "message": "unknown op '%s'" % op}}
    payload = req.get("payload") or {}
    try:
        result = fn(payload)
    except WorkerError as we:
        return {"protocol": "mathviz.sympy/v1", "request_id": req.get("request_id"), "ok": False, "error": {"code": we.code, "message": str(we)}}
    except Exception as exc:  # noqa: BLE001
        return {"protocol": "mathviz.sympy/v1", "request_id": req.get("request_id"), "ok": False, "error": {"code": "E_MATH_CONSTRAINT", "message": "%s: %s" % (type(exc).__name__, exc)}}
    return {
        "protocol": "mathviz.sympy/v1",
        "request_id": req.get("request_id"),
        "ok": True,
        "sympy_version": sp.__version__,
        "result": result,
    }


def main():
    sys.stderr.write("[mathviz-sympy] worker ready, sympy %s (pinned %s)\n" % (sp.__version__, PINNED))
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError as ve:
            emit({"ok": False, "error": {"code": "E_SCHEMA", "message": "bad json line: %s" % ve}})
            continue
        emit(handle(req))
    sys.stderr.write("[mathviz-sympy] worker exiting\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
