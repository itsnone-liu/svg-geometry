// Living predicates (G5/G14): every frozen claim is re-verified NUMERICALLY
// against the CURRENT snapshot — roots follow the parameter sweep, so
// f(root(a(t))) == 0 must hold at every evaluated frame, not just at freeze.

import type { AssertionOutcome } from "../../../runtime/src/domain";
import { evalExpr, ExprAst } from "../../../runtime/src/expr/evaluate";
import { ratToNumber } from "../../../runtime/src/expr/exact";
import type { Rat } from "../../../runtime/src/expr/exact";
import { claimValueToNumber } from "./compile";
import { differentiate } from "./differentiate";
import type { FunctionClaim, VerifiedFunctionProgram } from "./types";

type Env = Record<string, { kind: "exact"; r: Rat } | { kind: "num"; v: number }>;

function exprToNumber(ast: ExprAst, env: Env): number {
  const v = evalExpr(ast, env as any);
  return v.kind === "exact" ? ratToNumber(v.r) : v.v;
}

export function assertFunctions(program: VerifiedFunctionProgram, snapshot: any): AssertionOutcome[] {
  const out: AssertionOutcome[] = [];
  const entities = snapshot?.entities ?? {};
  const eps = program.samplingPolicy.eps;

  for (const a of program.assertions) {
    let allHold = true;
    const details: string[] = [];
    for (const claimId of a.claimIds) {
      const claim = program.derivedClaims.find((c) => c.id === claimId);
      if (!claim) {
        allHold = false;
        details.push(`claim '${claimId}' missing from program`);
        continue;
      }
      const fn = claim.functionIds.length ? program.functions.find((f) => f.id === claim.functionIds[0]) : undefined;
      const curve = fn ? entities[fn.id] : undefined;
      const pv = curve?.parameterValues;
      const env: Env = {};
      let inactive = false;
      if (fn && claim.kind !== "solve_equation") {
        // claim rides on a function curve: inherit its CURRENT parameters
        if (!pv) inactive = true;
        else if (Object.values(pv).some((v: any) => v === null)) inactive = true;
        else for (const [k, v] of Object.entries(pv)) env[k] = { kind: "num", v: v as number };
      }
      if (inactive) {
        // outside mapping window: math is inactive, nothing to violate
        details.push(`claim '${claimId}': inactive (parameter unresolved)`);
        continue;
      }
      const where = `claim '${claim.id}'`;
      let x: number;
      try {
        x = claimValueToNumber(claim.value, env, where);
      } catch (e: any) {
        allHold = false;
        details.push(`${where}: ${e?.message ?? "value evaluation failed"}`);
        continue;
      }
      const tol = eps * (1 + Math.abs(x));
      const e2: Env = { ...env };
      let ok = true;
      let note = "";
      switch (claim.kind) {
        case "roots": {
          e2[fn!.variable] = { kind: "num", v: x };
          const y = exprToNumber(fn!.expr, e2);
          ok = Math.abs(y) <= tol;
          note = `f(${x})=${y}`;
          break;
        }
        case "intersection": {
          const g = program.functions.find((f) => f.id === claim.functionIds[1])!;
          e2[fn!.variable] = { kind: "num", v: x };
          const ya = exprToNumber(fn!.expr, e2);
          const e3: Env = { ...env };
          e3[g.variable] = { kind: "num", v: x };
          const yb = exprToNumber(g.expr, e3);
          ok = Math.abs(ya - yb) <= tol;
          note = `f(${x})=${ya} g(${x})=${yb}`;
          break;
        }
        case "solve_equation": {
          const eq = program.equations.find((q) => q.id === claim.equationId)!;
          e2[eq.variable] = { kind: "num", v: x };
          const lhs = exprToNumber(eq.lhs, e2);
          const rhs = exprToNumber(eq.rhs, e2);
          ok = Math.abs(lhs - rhs) <= tol;
          note = `lhs(${x})=${lhs} rhs(${x})=${rhs}`;
          break;
        }
        case "extremum": {
          const d = differentiate(fn!.expr, fn!.variable);
          e2[fn!.variable] = { kind: "num", v: x };
          const dv = exprToNumber(d, e2);
          ok = Math.abs(dv) <= tol;
          note = `f'(${x})=${dv}`;
          break;
        }
        case "derivative_at": {
          const at = ratToNumber({ p: BigInt(claim.at!.p), q: BigInt(claim.at!.q) });
          const d = differentiate(fn!.expr, fn!.variable);
          e2[fn!.variable] = { kind: "num", v: at };
          const dv = exprToNumber(d, e2);
          ok = Math.abs(dv - x) <= eps * (1 + Math.abs(at));
          note = `f'(${at})=${dv} claimed=${x}`;
          break;
        }
        case "value_at": {
          const at = ratToNumber({ p: BigInt(claim.at!.p), q: BigInt(claim.at!.q) });
          e2[fn!.variable] = { kind: "num", v: at };
          const y = exprToNumber(fn!.expr, e2);
          ok = Math.abs(y - x) <= eps * (1 + Math.abs(at));
          note = `f(${at})=${y} claimed=${x}`;
          break;
        }
      }
      if (!ok) allHold = false;
      details.push(`${where}: ${note} ${ok ? "ok" : "VIOLATED"}`);
    }
    const pass = a.expectation === "forbidden" ? !allHold : allHold;
    out.push({
      assertion_id: a.assertionId,
      capability: a.capabilityId,
      pass,
      expectation: a.expectation,
      subjects: a.claimIds.map((id) => `fact:${id}`),
      detail: details.join("; ")
    });
  }
  return out;
}
