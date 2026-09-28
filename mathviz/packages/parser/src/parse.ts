// P5.1 semantic parser core with P5.1a request-level diagnostics.
// P5.2: the deterministic G19 grounding verifier is wired in as the fourth
// gate of attemptCompile (schema -> semantic -> compile -> grounding).
// Grounding failures surface as E_PROVENANCE_GROUNDING errors carrying a
// contract-level repair_hint, and share the pipeline's SINGLE repair budget:
// if that budget was already spent (e.g. on an earlier E_SCHEMA), a later
// grounding failure rejects immediately. A repaired candidate re-runs ALL
// gates, so post-repair semantics are fully re-grounded, never just the
// previously failed paths.
import { validatorFor } from "../../contracts/src/load";
import { validateProblemSpec } from "../../contracts/src/spec-validate";
import { compileProblemSpec } from "../../spec/src/compile";
import { groundProblemSpec } from "./grounding";
import { domainRoutingCall, specCall, repairCall } from "./prompt";
import { cacheGet, cachePut, repairDelta as diffTopLevel } from "./telemetry";
import { categoryForCode, type ParserError, type ParseOutcome, type ParseCallDiagnostic, type StructuredLLMProvider, type TokenUsage } from "./types";

export const MAX_REPAIRS = 1;
const ZERO: TokenUsage = { input_tokens: 0, output_tokens: 0 };
function addUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage {
  return { input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0), output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0) };
}

/** Contract-level repair hints for E_PROVENANCE_GROUNDING findings.
 * Deterministic, keyed only on the finding's path prefix and reason — never
 * on case content, never the golden span. Explains WHAT the contract
 * requires, not where the answer is. */
function groundingRepairHint(path: string, reason: string): string {
  if (reason === "invalid/mismatched source slice") return "span.text must equal original_statement.slice(span.start, span.end); re-cite the span against the original statement.";
  if (path.startsWith("/source_facts/")) {
    if (reason.includes("reused")) return "Each number+unit occurrence in the statement can ground only one fact; cite a distinct occurrence or re-check the fact set.";
    if (reason.includes("direction")) return "Cite the clause containing the numeric magnitude with its whole unit plus a direction cue local to that same clause, or an explicit signed literal; a shared relation phrase is not per-body evidence.";
    return "Cite text containing both the numeric magnitude and its declared whole unit adjacent to it.";
  }
  if (reason.startsWith("segment") || reason.startsWith("nonempty segment")) return "Choose a span that directly supports this segment: one containing the segment's own label, or containing both endpoint points together with their coordinates.";
  if (reason.includes("coordinate pair") || reason.includes("missing label")) return "Cite a local phrase containing both the point label and its ordered coordinate pair.";
  if (reason.includes("body slice")) return "Widen the body's cited span so it contains every linked fact's cited span, or re-cite the linked facts within the body's own clause.";
  if (reason.includes("AST token") || reason.includes("operator") || reason.includes("equality") || reason.includes("RHS")) return "Cite a slice that evidences every number, symbol, and operator of the expression, including the right-hand side, or the explicit equation/goal wording.";
  return "Choose a source span that directly supports this claim from the original statement.";
}

interface Attempt { ok: boolean; engineUnsupported: boolean; spec: any | null; errors: ParserError[]; compileError?: { code: string; message: string } | null }
export function attemptCompile(candidate: any, statement?: string): Attempt {
  if (!candidate || typeof candidate !== "object") return { ok: false, engineUnsupported: false, spec: null, errors: [{ code: "E_PROVIDER", category: "JSON_ERROR", message: "model output was not a JSON object" }] };
  const v = validatorFor("problemspec");
  if (!v(candidate)) return { ok: false, engineUnsupported: false, spec: null, errors: (v.errors ?? []).slice(0, 20).map((e: any) => ({ code: "E_SCHEMA", category: "SCHEMA_ERROR", path: String(e.instancePath ?? "") || undefined, message: `${String(e.message ?? "")}${e.params ? ` (${JSON.stringify(e.params)})` : ""}` })) };
  const semantic = validateProblemSpec(candidate);
  if (semantic.length) return { ok: false, engineUnsupported: false, spec: null, errors: semantic.map((e) => ({ code: e.code, category: categoryForCode(e.code), path: e.path, message: e.message })) };
  try {
    compileProblemSpec(candidate);
    // Gate 4 (P5.2): deterministic source grounding. Only reached when the
    // candidate already passed schema, semantic validation, and compilation —
    // engine-unsupported refusals short-circuit above and stay clean.
    if (typeof statement === "string") {
      const g = groundProblemSpec(candidate, statement);
      const ungrounded = g.findings.filter((f) => f.grounded === false);
      if (ungrounded.length) {
        return {
          ok: false, engineUnsupported: false, spec: null,
          errors: ungrounded.map((f) => ({ code: "E_PROVENANCE_GROUNDING", category: "PROVENANCE_ERROR" as const, path: `${f.path}/provenance/span`, message: f.reason, repair_hint: groundingRepairHint(f.path, f.reason) }))
        };
      }
    }
    return { ok: true, engineUnsupported: false, spec: candidate, errors: [], compileError: null };
  }
  catch (e: any) {
    const compileError = { code: e?.code ?? "E_SCHEMA", message: e?.message ?? String(e) };
    if (e?.code === "E_CAPABILITY_UNSUPPORTED" || e?.code === "E_MATH_CONSTRAINT") return { ok: false, engineUnsupported: true, spec: candidate, errors: [{ code: e.code, category: "COMPILER_UNSUPPORTED", message: compileError.message }], compileError };
    return { ok: false, engineUnsupported: false, spec: null, errors: [{ code: compileError.code, category: categoryForCode(compileError.code), message: compileError.message }], compileError };
  }
}

export async function routeDomain(provider: StructuredLLMProvider, statement: string): Promise<{ domain: string | null; usage: TokenUsage | null; error?: ParserError; diagnostic?: ParseCallDiagnostic }> {
  try {
    const res = await provider.generate<any>(domainRoutingCall(statement));
    const d = res.value?.domain;
    const error = d === "geometry2d" || d === "motion1d" || d === "function2d" ? undefined : { code: "E_SCHEMA", category: "DOMAIN_ERROR" as const, message: `domain routing returned '${String(d)}' (not one of the three domains)` };
    return { domain: error ? null : d, usage: res.usage, error, diagnostic: { stage: "A0", ...res.diagnostics, parsed_candidate: res.value, usage: res.usage, errors: error ? [error] : [] } };
  } catch (e: any) {
    const diagnostic = e?.diagnostics;
    const error = { code: e?.code ?? "E_PROVIDER", category: "DOMAIN_ERROR" as const, message: e?.message ?? String(e) };
    return { domain: null, usage: e?.usage ?? null, error, diagnostic: { stage: "A0", ...(diagnostic ?? {}), usage: e?.usage ?? null, errors: [error] } };
  }
}
export interface ParseOptions { domain?: string; noCache?: boolean }

export async function parseProblemSpec(provider: StructuredLLMProvider, statement: string, opts: ParseOptions = {}): Promise<ParseOutcome> {
  const diagnostics: ParseCallDiagnostic[] = [];
  let initialUsage: TokenUsage | null = null;
  let repairUsage: TokenUsage | null = null;
  let routingUsage: TokenUsage | null = null;
  const allErrors: ParserError[] = [];
  if (!opts.noCache) {
    const hit = cacheGet(provider.id, statement);
    if (hit) return { status: "PARSER_ACCEPTED", domain: hit?.domain ?? null, spec: hit, errors: [], repairUsed: false, repairDelta: null, usage: { initial: null, repair: null, total: ZERO }, cached: true, diagnostics: [], compileError: null };
  }
  let domain = opts.domain ?? null;
  if (!domain) {
    const routed = await routeDomain(provider, statement);
    routingUsage = routed.usage;
    initialUsage = addUsage(initialUsage, routed.usage);
    if (routed.diagnostic) diagnostics.push(routed.diagnostic);
    if (!routed.domain || routed.error) {
      if (routed.error) allErrors.push(routed.error);
      return { status: "PARSE_FAILED", domain: null, spec: null, errors: allErrors, repairUsed: false, repairDelta: null, usage: { initial: initialUsage, repair: null, total: addUsage(initialUsage, null) }, cached: false, diagnostics, compileError: null };
    }
    domain = routed.domain;
  }
  const callStage = async (stage: "A1" | "repair", call: { schema: unknown; system: string; input: string }, prior?: any) => {
    try {
      const res = await provider.generate<any>(call);
      const attempt = attemptCompile(res.value, statement);
      const diag: ParseCallDiagnostic = { stage, ...res.diagnostics, parsed_candidate: res.value, usage: res.usage, errors: attempt.errors };
      diagnostics.push(diag);
      return { attempt, doc: res.value, usage: res.usage, diag };
    } catch (e: any) {
      const error: ParserError = { code: e?.code ?? "E_PROVIDER", category: "JSON_ERROR", message: e?.message ?? String(e) };
      const diag: ParseCallDiagnostic = { stage, ...(e?.diagnostics ?? {}), usage: e?.usage ?? null, errors: [error] };
      diagnostics.push(diag);
      return { attempt: { ok: false, engineUnsupported: false, spec: null, errors: [error] } as Attempt, doc: null, usage: e?.usage ?? null, diag };
    }
  };
  const first = await callStage("A1", specCall(statement, domain));
  initialUsage = addUsage(routingUsage, first.usage);
  let current = first.attempt;
  if (!current.ok) allErrors.push(...current.errors);
  let repairUsed = false;
  let delta: number | null = null;
  if (!current.ok && !current.engineUnsupported) {
    repairUsed = true;
    const firstRaw = diagnostics.find((d) => d.stage === "A1")?.raw_text;
    const second = await callStage("repair", repairCall(statement, domain, first.doc, current.errors, firstRaw));
    repairUsage = second.usage;
    current = second.attempt;
    if (!current.ok) allErrors.push(...current.errors);
    if (first.doc && second.doc) delta = diffTopLevel(first.doc, second.doc);
  }
  const status: ParseOutcome["status"] = current.ok ? "PARSER_ACCEPTED" : current.engineUnsupported ? "ENGINE_UNSUPPORTED" : "PARSE_FAILED";
  if (status === "PARSER_ACCEPTED" && !opts.noCache) cachePut(provider.id, statement, current.spec);
  return {
    status, domain, spec: current.spec, errors: allErrors, repairUsed, repairDelta: delta,
    usage: { initial: initialUsage, repair: repairUsage, total: addUsage(initialUsage, repairUsage) },
    cached: false, diagnostics, compileError: current.compileError ?? null
  };
}
