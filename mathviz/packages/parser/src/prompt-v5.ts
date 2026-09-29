// P5.4 Stage-2A — vNext prompt overlay. The frozen v3 base prompt policy and
// the historical v4 overlay stay byte-identical; v5 callers opt into the
// named-function identity contract on top of the v4 dual-representation
// guidance.
import { specCall, repairCall } from "./prompt";
import { FUNCTION_ZERO_DUALITY_V4_GUIDANCE } from "./prompt-v4";
import type { LlmGenerateRequest } from "./types";

export const NAMED_FUNCTION_IDENTITY_V5_GUIDANCE = `
## Named-function identity contract (v5)
For an explicit source declaration f(x) = ..., the function entity MUST carry
label:"f" — the declared source function name. The entity id is NOT a
substitute for the declared function name.
- function entity: kind=function, label="<declared name>", props.variable=<declared variable>, props.expr=<source expression>;
- internal ids such as u_func / fn_u / function_17 are storage identifiers only;
- when repairing an identity error, set the missing label; do NOT add the
  function entity to any goal's inputs;
- the function2d.solve_equation goal takes EXACTLY ONE input: the separate
  equation entity (function expression = 0).
`;

export function specCallV5(statement: string, domain: string): LlmGenerateRequest {
  const call = specCall(statement, domain);
  return { ...call, system: `${call.system}\n${FUNCTION_ZERO_DUALITY_V4_GUIDANCE}\n${NAMED_FUNCTION_IDENTITY_V5_GUIDANCE}` };
}

export function repairCallV5(statement: string, domain: string, previousCandidate: any, errors: Array<{ code: string; path?: string; message: string; repair_hint?: string }>, previousRawText?: string): LlmGenerateRequest {
  const call = repairCall(statement, domain, previousCandidate, errors, previousRawText);
  return { ...call, system: `${call.system}\n${FUNCTION_ZERO_DUALITY_V4_GUIDANCE}\n${NAMED_FUNCTION_IDENTITY_V5_GUIDANCE}` };
}
