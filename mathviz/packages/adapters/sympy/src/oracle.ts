// Typed oracle surface for the P4 freeze runner (G13). Every method sends
// pre-verified ExprAst JSON and receives MathViz values; a worker error is
// rethrown as VizRuntimeError with the worker's code (E_CAPABILITY_UNSUPPORTED
// for non-finite solution sets, E_SCHEMA for out-of-vocabulary input).

import { makeRuntimeError } from "../../../runtime/src/errors";
import { SympyClient } from "./client";
import { PINNED_SYMPY_VERSION } from "./version";
import type { ExactNumberJson, ExtremaList, FiniteSolutionSet, SympyResponse } from "./protocol";

export class SympyOracle {
  constructor(private client: SympyClient) {}

  get version(): string { return this.client.version; }
  get pinnedVersion(): string { return PINNED_SYMPY_VERSION; }

  private async call(op: string, payload: Record<string, unknown>): Promise<any> {
    const resp: SympyResponse = await this.client.request(op, payload);
    if (!resp.ok) {
      throw makeRuntimeError(resp.error.code, `sympy oracle '${op}': ${resp.error.message}`);
    }
    if (resp.sympy_version !== PINNED_SYMPY_VERSION) {
      throw makeRuntimeError("E_CAPABILITY_UNSUPPORTED", `sympy ${resp.sympy_version} != pinned ${PINNED_SYMPY_VERSION}`);
    }
    return resp.result;
  }

  roots(expr: any, variable: string): Promise<FiniteSolutionSet> {
    return this.call("roots", { expr, variable });
  }

  intersection(f: any, g: any, variable: string): Promise<FiniteSolutionSet> {
    return this.call("intersection", { f, g, variable });
  }

  derivative(expr: any, variable: string): Promise<ExactNumberJson> {
    return this.call("derivative", { expr, variable });
  }

  extremum(expr: any, variable: string): Promise<ExtremaList> {
    return this.call("extremum", { expr, variable });
  }

  valueAt(expr: any, variable: string, x: ExactNumberJson): Promise<ExactNumberJson> {
    return this.call("value_at", { expr, variable, x });
  }

  solveEquation(lhs: any, rhs: any, variable: string): Promise<FiniteSolutionSet> {
    return this.call("solve_equation", { lhs, rhs, variable });
  }

  checkEqual(lhs: any, rhs: any): Promise<boolean> {
    return this.call("check_equal", { lhs, rhs }).then((r: { equal: boolean }) => r.equal);
  }
}
