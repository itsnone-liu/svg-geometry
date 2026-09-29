// P5.4 Stage-2 — v5 parser pipeline: named-function identity contract (2A),
// deterministic repair monotonicity (2B), goal-input over-reference detector
// (2C), corrected G19 function-anchor special case (2D via grounding-v5).
// The v3/v4 shared pipeline files stay byte-identical (frozen blobs).
import { validatorFor } from "../../contracts/src/load";
import { validateProblemSpec } from "../../contracts/src/spec-validate";
import { compileProblemSpec } from "../../spec/src/compile";
import { checkSourceFidelity } from "./fidelity";
import { checkIdentityV5 } from "./identity-v5";
import { auditRepairV5 } from "./repair-v5";
import { groundProblemSpecV5 } from "./grounding-v5";
import { specCallV5, repairCallV5 } from "./prompt-v5";
import { repairDelta as diffTopLevel } from "./telemetry";
import { categoryForCode, type ParserError, type ParseCallDiagnostic, type ParseOutcome, type StructuredLLMProvider, type TokenUsage } from "./types";

export interface V5Attempt {
  ok: boolean; engineUnsupported: boolean; spec: any | null; errors: ParserError[];
  compileError?: { code: string; message: string } | null;
  suppressedFindings: { items: Array<{ code: string; path: string }>; count: number };
}

const ZERO: TokenUsage = { input_tokens: 0, output_tokens: 0 };
const addUsage = (a: TokenUsage | null, b: TokenUsage | null): TokenUsage => ({ input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0), output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0) });

function asError(code: string, message: string, path?: string, repair_hint?: string): ParserError {
  const category = code.startsWith("E_FUNCTION_ZERO_") || code === "E_FUNCTION_DECLARATION_LABEL_MISSING" ? "FIDELITY_ERROR" : categoryForCode(code);
  return { code, category, ...(path ? { path } : {}), message, ...(repair_hint ? { repair_hint } : {}) };
}

/** v5 gate aggregation with identity-aware derived-error suppression. */
export function attemptCompileV5(candidate: any, statement?: string): V5Attempt {
  if (!candidate || typeof candidate !== "object") return { ok: false, engineUnsupported: false, spec: null, errors: [asError("E_PROVIDER", "model output was not a JSON object")], suppressedFindings: { items: [], count: 0 } };
  const v = validatorFor("problemspec");
  if (!v(candidate)) return { ok: false, engineUnsupported: false, spec: null, errors: (v.errors ?? []).slice(0, 20).map((e: any) => asError("E_SCHEMA", `${String(e.message ?? "")}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`, String(e.instancePath ?? "") || undefined)), suppressedFindings: { items: [], count: 0 } };
  const semantic = validateProblemSpec(candidate);
  if (semantic.length) return { ok: false, engineUnsupported: false, spec: null, errors: semantic.map((e) => asError(e.code, e.message, e.path)), suppressedFindings: { items: [], count: 0 } };

  const identity = statement ? checkIdentityV5(candidate, statement) : { applicable: false, findings: [], labelMissing: null, suppression: null, resolved: { functionEntity: null, equationEntity: null } };
  const suppression = identity.labelMissing ? identity.suppression : null;
  /** Stage-3.1: PATH-SCOPED suppression only — same-code errors on other
   * entities/declarations are independent findings and always survive. */
  const suppressedBy = (code: string, path?: string) => {
    if (!suppression) return false;
    if (code === "E_SOURCE_COMPLETENESS") return path === suppression.declarationPath;
    if (code === "E_SOURCE_IRRELEVANT") return path === suppression.entityPath;
    if (code === "E_PROVENANCE_GROUNDING") return path === suppression.entitySpanPath;
    return false;
  };

  const errors: ParserError[] = [];
  const suppressedItems: Array<{ code: string; path: string }> = [];
  const push = (code: string, message: string, path?: string, repair_hint?: string) => {
    if (suppressedBy(code, path)) { suppressedItems.push({ code, path: path ?? "" }); return; }
    errors.push(asError(code, message, path, repair_hint));
  };

  for (const f of identity.findings) push(f.code, f.message, f.path, f.repair_hint);

  if (typeof statement === "string") {
    const fidelity = checkSourceFidelity(candidate, statement);
    for (const f of fidelity.findings) push(f.code, f.message, f.path, f.repair_hint);
  }

  let compileError: { code: string; message: string } | null = null;
  let compilerUnsupported = false;
  try { compileProblemSpec(candidate); }
  catch (e: any) {
    compileError = { code: e?.code ?? "E_SCHEMA", message: e?.message ?? String(e) };
    compilerUnsupported = e?.code === "E_CAPABILITY_UNSUPPORTED" || e?.code === "E_MATH_CONSTRAINT";
    if (!suppressedBy(compileError.code)) errors.push(asError(compileError.code, compileError.message));
    else suppressedItems.push({ code: compileError.code, path: "" });
  }

  if (typeof statement === "string") {
    try {
      const grounding = groundProblemSpecV5(candidate, statement);
      for (const f of grounding.findings.filter((x: any) => x.grounded === false)) push("E_PROVENANCE_GROUNDING", f.reason, `${f.path}/provenance/span`, "Choose a source span that directly supports this claim from the original statement.");
    } catch (e: any) {
      push("E_PROVENANCE_GROUNDING", e?.message ?? String(e));
    }
  }

  const parserErrors = errors.filter((e) => e.code !== compileError?.code || e.message !== compileError?.message);
  const engineUnsupported = compilerUnsupported && parserErrors.length === 0;
  return {
    ok: errors.length === 0, engineUnsupported, spec: errors.length === 0 ? candidate : null, errors, compileError,
    suppressedFindings: { items: suppressedItems, count: suppressedItems.length },
  };
}

export interface ParseV5Options { domain?: string }
export interface RepairAuditRecord {
  verdict: "allowed" | "projected";
  model_repair_candidate: any;
  projected_candidate: any;
  protected_paths_restored: string[];
  audit_notes: string[];
  /** Gate outcome of the projected candidate (evidence only — never a second
   * provider call; Stage-3.1 H4 keeps 1 repair request = 1 repair diagnostic). */
  projected_gates: { ok: boolean; engineUnsupported: boolean; errors: string[] } | null;
}

/** v5 single-pass pipeline: A1 -> gates -> (repair -> MUTATION AUDIT -> gates). */
export async function parseProblemSpecV5(provider: StructuredLLMProvider, statement: string, opts: ParseV5Options = {}): Promise<ParseOutcome & { repairAudit: RepairAuditRecord | null; suppressedFindings: { initial: number; final: number } }> {
  const diagnostics: ParseCallDiagnostic[] = [];
  let initialUsage: TokenUsage | null = null;
  let repairUsage: TokenUsage | null = null;
  const domain = opts.domain ?? "function2d";
  const call = async (stage: "A1" | "repair", request: any, candidate?: any) => {
    try {
      const res = await provider.generate<any>(request);
      const attempt = attemptCompileV5(res.value, statement);
      diagnostics.push({ stage, ...res.diagnostics, parsed_candidate: res.value, usage: res.usage, errors: attempt.errors });
      return { ...attempt, doc: res.value, raw: res.diagnostics.raw_text, usage: res.usage };
    } catch (e: any) {
      const error = asError(e?.code ?? "E_PROVIDER", e?.message ?? String(e));
      diagnostics.push({ stage, ...(e?.diagnostics ?? {}), usage: e?.usage ?? null, errors: [error] });
      return { ok: false, engineUnsupported: false, spec: null, errors: [error], doc: candidate ?? null, raw: e?.diagnostics?.raw_text, usage: e?.usage ?? null, compileError: null, suppressedFindings: { items: [], count: 0 } };
    }
  };

  const first = await call("A1", specCallV5(statement, domain));
  initialUsage = first.usage;
  let current = first;
  let repairUsed = false;
  let repairAudit: RepairAuditRecord | null = null;
  let delta: number | null = null;
  const suppressed = { initial: first.suppressedFindings.count, final: first.suppressedFindings.count };

  if (!current.ok && !current.engineUnsupported) {
    repairUsed = true;
    const second = await call("repair", repairCallV5(statement, domain, first.doc, first.errors, first.raw), first.doc);
    repairUsage = second.usage;
    // Stage-2B: deterministic mutation audit — the model's raw candidate is
    // never trusted wholesale; protected conforming fields are projected back
    // and the full audit is recorded.
    const audit = auditRepairV5(first.doc, second.doc, first.errors);
    if (first.doc && second.doc) delta = diffTopLevel(first.doc, second.doc);
    if (audit.verdict === "projected") {
      // Stage-3.1 (H4): the audit projection is NOT a second model call — no
      // extra "repair" diagnostic is emitted (1 provider repair request = 1
      // repair diagnostic; the projected evidence lives in repairAudit).
      const audited = attemptCompileV5(audit.projected_candidate, statement);
      repairAudit = { ...audit, projected_gates: { ok: audited.ok, engineUnsupported: audited.engineUnsupported, errors: audited.errors.map((e) => e.code) } };
      current = { ...audited, doc: audit.projected_candidate, raw: second.raw, usage: second.usage };
      suppressed.final = audited.suppressedFindings.count;
    } else {
      repairAudit = { ...audit, projected_gates: null };
      current = second;
      suppressed.final = second.suppressedFindings.count;
    }
  }

  const status: ParseOutcome["status"] = current.ok ? "PARSER_ACCEPTED" : current.engineUnsupported ? "ENGINE_UNSUPPORTED" : "PARSE_FAILED";
  return {
    status, domain, spec: current.spec, errors: current.errors, repairUsed,
    repairDelta: delta,
    repairAudit,
    suppressedFindings: suppressed,
    usage: { initial: initialUsage, repair: repairUsage, total: addUsage(initialUsage, repairUsage) },
    cached: false, diagnostics, compileError: current.compileError ?? null,
  };
}
