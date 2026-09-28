// P5.3 v4 prompt overlay. v3 prompt policy remains frozen; callers for a new
// preregistered version may opt into this explicit dual-representation clause.
import { repairCall, specCall } from "./prompt";

export const FUNCTION_ZERO_DUALITY_V4_GUIDANCE = `
## Function2D zero-finding dual-representation contract (v4)
When the source explicitly declares a named function and asks for its zeros:
- preserve the declaration as a separate function entity;
- ALSO create a separate equation entity representing that function expression equal to zero;
- the function2d.solve_equation goal MUST reference the equation entity;
- do not replace the function declaration with the equation;
- do not replace the equation with the function;
- normalize(function.expr) MUST equal normalize(equation.lhs), and equation.rhs MUST be zero.
This is required by the existing ProblemSpec/compiler contract: solve_equation goals consume equation entities.
`;

export function specCallV4(statement: string, domain: string) {
  const call = specCall(statement, domain);
  return { ...call, system: `${call.system}\n${FUNCTION_ZERO_DUALITY_V4_GUIDANCE}` };
}

export function repairCallV4(statement: string, domain: string, previousCandidate: any, errors: Array<{ code: string; path?: string; message: string; repair_hint?: string }>, previousRawText?: string) {
  const call = repairCall(statement, domain, previousCandidate, errors, previousRawText);
  return { ...call, system: `${call.system}\n${FUNCTION_ZERO_DUALITY_V4_GUIDANCE}` };
}
