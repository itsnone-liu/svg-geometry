// Error mapping for upstream kernel exceptions (node-side adapter only).

import { makeRuntimeError } from "../../../runtime/src/errors";

export function wrapOracleError(e: unknown, what: string): never {
  if (e && typeof e === "object" && "code" in (e as any)) {
    throw makeRuntimeError((e as any).code, `geometry-dsl oracle ${what}: ${(e as any).message}`);
  }
  throw makeRuntimeError("E_MATH_CONSTRAINT", `geometry-dsl oracle ${what}: ${(e as any)?.message ?? String(e)}`);
}

export { makeRuntimeError };
