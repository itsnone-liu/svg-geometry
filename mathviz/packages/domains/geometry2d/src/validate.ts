// Thin validation entry: geometry validation IS compilation (a program that
// compiles is valid; every invalid shape throws a cataloged VizRuntimeError).
// Kept as a separate module to mirror the package layout contract.

import { compileGeometry } from "./compile";

export function validateGeometry(math: unknown): { ok: true; digest: string } {
  const program = compileGeometry(math);
  return { ok: true, digest: program.digest };
}
