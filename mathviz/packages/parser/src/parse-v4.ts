// P5.3 v4-only parser pipeline. v3 parse.ts is intentionally untouched.
// Diagnostics are collected before the single repair: G20-A/B/C/D, compile
// viability, and G19 grounding (when executable). A repair reruns every gate.
import { validatorFor } from "../../contracts/src/load";
import { validateProblemSpec } from "../../contracts/src/spec-validate";
import { compileProblemSpec } from "../../spec/src/compile";
import { groundProblemSpec } from "./grounding";
import { checkSourceFidelity } from "./fidelity";
import { functionZeroErrors } from "./function-zero-duality";
import { specCallV4, repairCallV4 } from "./prompt-v4";
import { repairDelta as diffTopLevel } from "./telemetry";
import { categoryForCode, type ParserError, type ParseCallDiagnostic, type ParseOutcome, type StructuredLLMProvider, type TokenUsage } from "./types";

export interface V4Attempt { ok: boolean; engineUnsupported: boolean; spec: any | null; errors: ParserError[]; compileError?: { code: string; message: string } | null }
const ZERO: TokenUsage = { input_tokens: 0, output_tokens: 0 };
const addUsage = (a: TokenUsage | null, b: TokenUsage | null): TokenUsage => ({ input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0), output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0) });

function asError(code: string, message: string, path?: string, repair_hint?: string): ParserError {
  const category = code.startsWith("E_FUNCTION_ZERO_") ? "FIDELITY_ERROR" : categoryForCode(code);
  return { code, category, ...(path ? { path } : {}), message, ...(repair_hint ? { repair_hint } : {}) };
}

/** v4 gate aggregation; compile failure does not short-circuit G20/G19. */
export function attemptCompileV4(candidate: any, statement?: string): V4Attempt {
  if (!candidate || typeof candidate !== "object") return { ok: false, engineUnsupported: false, spec: null, errors: [asError("E_PROVIDER", "model output was not a JSON object")] };
  const v = validatorFor("problemspec");
  if (!v(candidate)) return { ok: false, engineUnsupported: false, spec: null, errors: (v.errors ?? []).slice(0, 20).map((e: any) => asError("E_SCHEMA", `${String(e.message ?? "")}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`, String(e.instancePath ?? "") || undefined)) };
  const semantic = validateProblemSpec(candidate);
  if (semantic.length) return { ok: false, engineUnsupported: false, spec: null, errors: semantic.map((e) => asError(e.code, e.message, e.path)) };

  const errors: ParserError[] = [];
  if (typeof statement === "string") {
    const fidelity = checkSourceFidelity(candidate, statement);
    errors.push(...fidelity.findings.map((f) => asError(f.code, f.message, f.path, f.repair_hint)));
    errors.push(...functionZeroErrors(candidate, statement));
  }

  let compileError: { code: string; message: string } | null = null;
  let compilerUnsupported = false;
  try { compileProblemSpec(candidate); }
  catch (e: any) {
    compileError = { code: e?.code ?? "E_SCHEMA", message: e?.message ?? String(e) };
    compilerUnsupported = e?.code === "E_CAPABILITY_UNSUPPORTED" || e?.code === "E_MATH_CONSTRAINT";
    errors.push(asError(compileError.code, compileError.message));
  }

  if (typeof statement === "string") {
    try {
      const grounding = groundProblemSpec(candidate, statement);
      errors.push(...grounding.findings.filter((f) => f.grounded === false).map((f) => asError("E_PROVENANCE_GROUNDING", f.reason, `${f.path}/provenance/span`, "Choose a source span that directly supports this claim from the original statement.")));
    } catch (e: any) {
      errors.push(asError("E_PROVENANCE_GROUNDING", e?.message ?? String(e)));
    }
  }
  const parserErrors = errors.filter((e) => e.code !== compileError?.code || e.message !== compileError?.message);
  const engineUnsupported = compilerUnsupported && parserErrors.length === 0;
  return { ok: errors.length === 0, engineUnsupported, spec: errors.length === 0 ? candidate : null, errors, compileError };
}

export interface ParseV4Options { domain?: string }
export async function parseProblemSpecV4(provider: StructuredLLMProvider, statement: string, opts: ParseV4Options = {}): Promise<ParseOutcome> {
  const diagnostics: ParseCallDiagnostic[] = [];
  let initialUsage: TokenUsage | null = null;
  let repairUsage: TokenUsage | null = null;
  const domain = opts.domain ?? "function2d";
  const call = async (stage: "A1" | "repair", request: any, candidate?: any) => {
    try {
      const res = await provider.generate<any>(request);
      const attempt = attemptCompileV4(res.value, statement);
      diagnostics.push({ stage, ...res.diagnostics, parsed_candidate: res.value, usage: res.usage, errors: attempt.errors });
      return { ...attempt, doc: res.value, raw: res.diagnostics.raw_text, usage: res.usage };
    } catch (e: any) {
      const error = asError(e?.code ?? "E_PROVIDER", e?.message ?? String(e));
      diagnostics.push({ stage, ...(e?.diagnostics ?? {}), usage: e?.usage ?? null, errors: [error] });
      return { ok: false, engineUnsupported: false, spec: null, errors: [error], doc: candidate ?? null, raw: e?.diagnostics?.raw_text, usage: e?.usage ?? null, compileError: null };
    }
  };
  const first = await call("A1", specCallV4(statement, domain));
  initialUsage = first.usage;
  let current = first;
  let repairUsed = false;
  let delta: number | null = null;
  if (!current.ok && !current.engineUnsupported) {
    repairUsed = true;
    const second = await call("repair", repairCallV4(statement, domain, first.doc, first.errors, first.raw), first.doc);
    repairUsage = second.usage;
    current = second;
    if (first.doc && second.doc) delta = diffTopLevel(first.doc, second.doc);
  }
  const status: ParseOutcome["status"] = current.ok ? "PARSER_ACCEPTED" : current.engineUnsupported ? "ENGINE_UNSUPPORTED" : "PARSE_FAILED";
  return { status, domain, spec: current.spec, errors: current.errors, repairUsed, repairDelta: delta, usage: { initial: initialUsage, repair: repairUsage, total: addUsage(initialUsage, repairUsage) }, cached: false, diagnostics, compileError: current.compileError ?? null };
}
