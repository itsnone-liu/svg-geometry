// P4 §1-2: frozen SymPy adapter contract. The pinned version is asserted by
// BOTH the worker (refuses to serve otherwise) and the Node client (freeze
// gate reports INCOMPLETE, never green, on mismatch).

export const SYMPY_PROTOCOL = "mathviz.sympy/v1";
export const PINNED_SYMPY_VERSION = "1.14.0";
