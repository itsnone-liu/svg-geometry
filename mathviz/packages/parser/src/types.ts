// P5.1 shared parser types: provider surface, usage, outcome classification.

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface LlmGenerateRequest {
  /** JSON Schema the output must satisfy (best-effort provider-side constraint). */
  schema: unknown;
  system: string;
  input: string;
}

export interface LlmGenerateResult<T> {
  value: T;
  usage: TokenUsage;
  model: string;
}

/**
 * Provider-neutral structured generation. The core parser NEVER binds to a
 * concrete model API; live deployments inject an OpenAI-compatible provider
 * (MATHVIZ_LLM_BASE_URL/API_KEY/MODEL), tests and gates inject
 * Scripted/Golden providers (zero tokens, zero network).
 */
export interface StructuredLLMProvider {
  /** Stable provider id — part of the deterministic cache key. */
  readonly id: string;
  generate<T>(req: LlmGenerateRequest): Promise<LlmGenerateResult<T>>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly code = "E_PROVIDER") {
    super(message);
  }
}

/** Parser error taxonomy (P5.1 §22). The load-bearing split is
 * COMPILER_UNSUPPORTED: a spec that parses cleanly but exceeds the engine's
 * current capability is NOT a parser failure. */
export type ParserErrorCategory =
  | "DOMAIN_ERROR"
  | "JSON_ERROR"
  | "SCHEMA_ERROR"
  | "PROVENANCE_ERROR"
  | "BINDING_ERROR"
  | "CAPABILITY_ERROR"
  | "COMPILER_UNSUPPORTED";

export interface ParserError {
  code: string;
  category: ParserErrorCategory;
  /** JSON path when known (schema errors), else omitted. */
  path?: string;
  message: string;
}

export function categoryForCode(code: string): ParserErrorCategory {
  switch (code) {
    case "E_PROVENANCE": return "PROVENANCE_ERROR";
    case "E_BINDING": return "BINDING_ERROR";
    case "E_CAPABILITY_UNSUPPORTED": return "CAPABILITY_ERROR";
    case "E_SCHEMA": return "SCHEMA_ERROR";
    default: return "SCHEMA_ERROR";
  }
}

export interface ParseUsage {
  initial: TokenUsage | null;
  repair: TokenUsage | null;
  total: TokenUsage;
}

export interface ParseOutcome {
  /** PARSER_ACCEPTED: schema + semantics + deterministic compile all passed.
   *  ENGINE_UNSUPPORTED: spec valid, engine refused (not a parser failure).
   *  PARSE_FAILED: everything else, after at most one repair. */
  status: "PARSER_ACCEPTED" | "ENGINE_UNSUPPORTED" | "PARSE_FAILED";
  domain: string | null;
  /** The VALIDATED ProblemSpec (null unless PARSER_ACCEPTED; on
   * ENGINE_UNSUPPORTED the valid-but-uncompilable spec is attached for
   * auditing). */
  spec: any | null;
  errors: ParserError[];
  repairUsed: boolean;
  /** Top-level paths changed by the repair round (benchmark signal). */
  repairDelta: number | null;
  usage: ParseUsage;
  /** True when the answer came from the validated-spec cache (no tokens). */
  cached: boolean;
}
