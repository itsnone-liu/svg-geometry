// geometry2d DomainAdapter — the P2 implementation surface.
//
// supports() is the honest boundary between "the registry KNOWS a
// capability" and "this adapter IMPLEMENTS it": geometry2d.locus is a
// registry id, but supports() returns false until it is actually built,
// and the compiler turns that into E_CAPABILITY_UNSUPPORTED.

import type { DomainAdapter, DomainEvaluationContext, DomainProgram, DomainSnapshot } from "../../../runtime/src/domain";
import { compileGeometry } from "./compile";
import { evaluateGeometry } from "./evaluate";
import { assertGeometry } from "./assertions";
import type { VerifiedGeometryProgram } from "./types";
import { GEOMETRY2D_ADAPTER_VERSION, GEOMETRY_EPS, GEOMETRY_NUMERIC_POLICY, P2_CAPABILITIES } from "./constants";

export { GEOMETRY2D_ADAPTER_VERSION, GEOMETRY_EPS, GEOMETRY_NUMERIC_POLICY, P2_CAPABILITIES };

const ADAPTER_VERSION = GEOMETRY2D_ADAPTER_VERSION;

export const geometry2dAdapter: DomainAdapter = {
  domain: "geometry2d",
  version: GEOMETRY2D_ADAPTER_VERSION,
  supports(capabilityId: string): boolean {
    return P2_CAPABILITIES.has(capabilityId);
  },
  compile(math: unknown): DomainProgram {
    return compileGeometry(math) as unknown as DomainProgram;
  },
  evaluate(program: DomainProgram, ctx: DomainEvaluationContext): DomainSnapshot {
    return evaluateGeometry(program as unknown as VerifiedGeometryProgram, ctx);
  },
  assert(program: DomainProgram, snapshot: DomainSnapshot) {
    return assertGeometry(program as unknown as VerifiedGeometryProgram, snapshot);
  }
};
