import type { DomainAdapter, DomainEvaluationContext, DomainProgram, DomainSnapshot } from "../../../runtime/src/domain";
import { compileMotion } from "./compile";
import { evaluateMotion } from "./evaluate";
import { assertMotion } from "./assertions";
import type { VerifiedMotionProgram } from "./types";
import { MOTION1D_ADAPTER_VERSION, MOTION1D_CAPABILITIES } from "./constants";

export const motion1dAdapter: DomainAdapter = {
  domain: "motion1d",
  version: MOTION1D_ADAPTER_VERSION,
  supports(capabilityId: string): boolean { return MOTION1D_CAPABILITIES.has(capabilityId); },
  compile(math: unknown): DomainProgram { return compileMotion(math) as unknown as DomainProgram; },
  evaluate(program: DomainProgram, ctx: DomainEvaluationContext): DomainSnapshot { return evaluateMotion(program as unknown as VerifiedMotionProgram, ctx); },
  assert(program: DomainProgram, snapshot: DomainSnapshot) { return assertMotion(program as unknown as VerifiedMotionProgram, snapshot as any); }
};
