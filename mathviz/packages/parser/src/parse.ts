// P5.1 semantic parser core: NL problem -> validated, compiled ProblemSpec.
//
// Two logical LLM calls (§15): A0 domain routing, A1 spec generation.
// Deterministic validation in between at every step (§19): JSON-only output
// (fences defensively stripped inside providers), schema gate, semantic
// validator, then the deterministic compiler. One repair round MAX (§21):
// the model receives the structured error list and must return a COMPLETE
// corrected spec; the pipeline never patches documents incrementally.
//
// Outcome classification (§22-23): a spec that validates but cannot compile
// is ENGINE_UNSUPPORTED — not a parser failure. Everything else that fails
// is PARSE_FAILED with a categorized error.

import { validatorFor } from "../../contracts/src/load";
import { validateProblemSpec } from "../../contracts/src/spec-validate";
import { compileProblemSpec } from "../../spec/src/compile";
import { domainRoutingCall, specCall, repairCall } from "./prompt";
import { cacheGet, cachePut, repairDelta as diffTopLevel } from "./telemetry";
import {
  categoryForCode,
  type ParserError,
  type ParseOutcome,
  type StructuredLLMProvider,
  type TokenUsage
} from "./types";

export const MAX_REPAIRS = 1;

function addUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage {
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0)
  };
}

interface Attempt {
  ok: boolean;
  engineUnsupported: boolean;
  spec: any | null;
  errors: ParserError[];
}

/** Schema + semantics + deterministic compile for one candidate document. */
export function attemptCompile(candidate: any): Attempt {
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, engineUnsupported: false, spec: null, errors: [{ code: "E_PROVIDER", category: "JSON_ERROR", message: "model output was not a JSON object" }] };
  }
  const schemaValidator = validatorFor("problemspec");
  if (!schemaValidator(candidate)) {
    const errors: ParserError[] = (schemaValidator.errors ?? []).slice(0, 20).map((e: any) => ({
      code: "E_SCHEMA",
      category: "SCHEMA_ERROR" as const,
      path: String(e.instancePath ?? "") || undefined,
      message: `${String(e.message ?? "")}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`
    }));
    return { ok: false, engineUnsupported: false, spec: null, errors };
  }
  const semantic = validateProblemSpec(candidate);
  if (semantic.length > 0) {
    return {
      ok: false,
      engineUnsupported: false,
      spec: null,
      errors: semantic.map((e) => ({ code: e.code, category: categoryForCode(e.code), message: e.message }))
    };
  }
  try {
    compileProblemSpec(candidate);
    return { ok: true, engineUnsupported: false, spec: candidate, errors: [] };
  } catch (e: any) {
    // Spec is valid but the engine refuses to answer it: the capability is
    // outside the compiler's wired surface, or the (valid) problem has no
    // legal solution under the engine's constraints. Either way this is
    // NOT a parser failure — the parser did its job.
    if (e?.code === "E_CAPABILITY_UNSUPPORTED" || e?.code === "E_MATH_CONSTRAINT") {
      return {
        ok: false,
        engineUnsupported: true,
        spec: candidate,
        errors: [{ code: e.code, category: "COMPILER_UNSUPPORTED", message: e?.message ?? String(e) }]
      };
    }
    return {
      ok: false,
      engineUnsupported: false,
      spec: null,
      errors: [{ code: e?.code ?? "E_SCHEMA", category: categoryForCode(e?.code ?? "E_SCHEMA"), message: e?.message ?? String(e) }]
    };
  }
}

export async function routeDomain(provider: StructuredLLMProvider, statement: string): Promise<{ domain: string | null; usage: TokenUsage | null; error?: ParserError }> {
  try {
    const res = await provider.generate<any>(domainRoutingCall(statement));
    const d = res?.value?.domain;
    if (d === "geometry2d" || d === "motion1d" || d === "function2d") return { domain: d, usage: res.usage };
    return { domain: null, usage: res.usage, error: { code: "E_SCHEMA", category: "DOMAIN_ERROR", message: `domain routing returned '${String(d)}' (not one of the three domains)` } };
  } catch (e: any) {
    return { domain: null, usage: null, error: { code: "E_PROVIDER", category: "DOMAIN_ERROR", message: e?.message ?? String(e) } };
  }
}

export interface ParseOptions {
  /** Skip the A0 routing call (benchmark/repair already knows the domain). */
  domain?: string;
  /** Disable the validated-spec cache (tests that must observe calls). */
  noCache?: boolean;
}

export async function parseProblemSpec(provider: StructuredLLMProvider, statement: string, opts: ParseOptions = {}): Promise<ParseOutcome> {
  let initialUsage: TokenUsage | null = null;
  let repairUsage: TokenUsage | null = null;
  const allErrors: ParserError[] = [];

  // ---- validated-spec cache: same contract + policy + provider + statement ----
  if (!opts.noCache) {
    const hit = cacheGet(provider.id, statement);
    if (hit) {
      return {
        status: "PARSER_ACCEPTED",
        domain: hit?.domain ?? null,
        spec: hit,
        errors: [],
        repairUsed: false,
        repairDelta: null,
        usage: { initial: null, repair: null, total: { input_tokens: 0, output_tokens: 0 } },
        cached: true
      };
    }
  }

  // ---- A0: domain routing (skipped when the caller pins the domain) ----
  let domain = opts.domain ?? null;
  if (!domain) {
    const routed = await routeDomain(provider, statement);
    initialUsage = addUsage(initialUsage, routed.usage);
    if (routed.error || !routed.domain) {
      if (routed.error) allErrors.push(routed.error);
      return {
        status: "PARSE_FAILED",
        domain: null,
        spec: null,
        errors: allErrors,
        repairUsed: false,
        repairDelta: null,
        usage: { initial: initialUsage, repair: null, total: addUsage(initialUsage, null) },
        cached: false
      };
    }
    domain = routed.domain;
  }

  // ---- A1 + (at most) one repair round ----
  const runCall = async (call: { schema: unknown; system: string; input: string }) => {
    try {
      const res = await provider.generate<any>(call);
      return { attempt: attemptCompile(res.value), usage: res.usage as TokenUsage | null, doc: res.value ?? null };
    } catch (e: any) {
      return {
        attempt: { ok: false, engineUnsupported: false, spec: null, errors: [{ code: "E_PROVIDER", category: "JSON_ERROR", message: e?.message ?? String(e) }] } as Attempt,
        usage: null as TokenUsage | null,
        doc: null as any
      };
    }
  };

  const first = await runCall(specCall(statement, domain));
  initialUsage = first.usage;
  let current = first.attempt;
  if (!current.ok) allErrors.push(...current.errors);

  let repairUsed = false;
  let delta: number | null = null;
  if (!current.ok && !current.engineUnsupported) {
    repairUsed = true;
    const second = await runCall(repairCall(statement, domain, current.errors));
    repairUsage = second.usage;
    current = second.attempt;
    if (!current.ok) allErrors.push(...current.errors);
    if (first.doc && second.doc) delta = diffTopLevel(first.doc, second.doc);
  }

  const status: ParseOutcome["status"] = current.ok
    ? "PARSER_ACCEPTED"
    : current.engineUnsupported
      ? "ENGINE_UNSUPPORTED"
      : "PARSE_FAILED";

  if (status === "PARSER_ACCEPTED" && !opts.noCache) {
    cachePut(provider.id, statement, current.spec);
  }

  return {
    status,
    domain,
    spec: current.spec,
    errors: allErrors,
    repairUsed,
    repairDelta: delta,
    usage: { initial: initialUsage, repair: repairUsage, total: addUsage(initialUsage, repairUsage) },
    cached: false
  };
}
