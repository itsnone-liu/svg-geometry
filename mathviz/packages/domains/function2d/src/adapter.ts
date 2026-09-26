import type { DomainAdapter, DomainEvaluationContext, DomainProgram, DomainSnapshot } from "../../../runtime/src/domain";
import { compileFunction } from "./compile";
import { evaluateFunction } from "./evaluate";
import { assertFunctions } from "./assertions";
import type { VerifiedFunctionProgram } from "./types";
import { FUNCTION2D_ADAPTER_VERSION, FUNCTION2D_CAPABILITIES } from "./constants";

export const function2dAdapter: DomainAdapter = {
  domain: "function2d",
  version: FUNCTION2D_ADAPTER_VERSION,
  supports(capabilityId: string): boolean { return FUNCTION2D_CAPABILITIES.has(capabilityId); },
  compile(math: unknown): DomainProgram { return compileFunction(math as any) as unknown as DomainProgram; },
  evaluate(program: DomainProgram, ctx: DomainEvaluationContext): DomainSnapshot {
    return evaluateFunction(program as unknown as VerifiedFunctionProgram, ctx);
  },
  assert(program: DomainProgram, snapshot: DomainSnapshot) {
    return assertFunctions(program as unknown as VerifiedFunctionProgram, snapshot);
  }
};
