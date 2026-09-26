// Binding transforms. The Scene IR declares a closed transform vocabulary
// (screen_offset / scale / project). P1 implements NONE of them: a binding
// that carries a transform is rejected explicitly with E_CAPABILITY_UNSUPPORTED
// instead of being silently ignored. Implementation lands with the layout work.

import { makeRuntimeError } from "../errors";

export function assertNoTransform(binding: any): void {
  if (binding && binding.transform !== undefined && binding.transform !== null) {
    throw makeRuntimeError(
      "E_CAPABILITY_UNSUPPORTED",
      `binding transform '${JSON.stringify(binding.transform)}' is declared but not implemented in P1`
    );
  }
}
