// The deterministic G19 grounding implementation now lives in
// packages/parser/src/grounding.ts (P5.2 wires it into the parser gate
// chain as E_PROVENANCE_GROUNDING). This module re-exports it verbatim so
// the frozen benchmark scoring path and existing imports keep working with
// a single shared implementation — parser and benchmark can never drift.
export * from "../../parser/src/grounding";
