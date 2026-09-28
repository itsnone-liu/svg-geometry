// P5.1 structured parser types and safe diagnostics.
export interface TokenUsage { input_tokens: number; output_tokens: number }
export interface ProviderDiagnostics {
  raw_text?: string;
  model: string;
  finish_reason?: string | null;
  request_id?: string | null;
}
export interface LlmGenerateRequest { schema: unknown; system: string; input: string }
export interface LlmGenerateResult<T> {
  value: T;
  usage: TokenUsage;
  model: string;
  diagnostics: ProviderDiagnostics;
}
export interface StructuredLLMProvider {
  readonly id: string;
  generate<T>(req: LlmGenerateRequest): Promise<LlmGenerateResult<T>>;
}
export class ProviderError extends Error {
  constructor(message: string, readonly code = "E_PROVIDER", readonly diagnostics?: ProviderDiagnostics, readonly usage?: TokenUsage) { super(message); }
}
export type ParserErrorCategory = "DOMAIN_ERROR" | "JSON_ERROR" | "SCHEMA_ERROR" | "PROVENANCE_ERROR" | "FIDELITY_ERROR" | "BINDING_ERROR" | "CAPABILITY_ERROR" | "COMPILER_UNSUPPORTED";
export interface ParserError { code: string; category: ParserErrorCategory; path?: string; message: string; repair_hint?: string }
export function categoryForCode(code: string): ParserErrorCategory {
  switch (code) {
    case "E_PROVENANCE": return "PROVENANCE_ERROR";
    case "E_PROVENANCE_GROUNDING": return "PROVENANCE_ERROR";
    case "E_SOURCE_COMPLETENESS": return "FIDELITY_ERROR";
    case "E_SOURCE_EXPRESSION_LOSS": return "FIDELITY_ERROR";
    case "E_SOURCE_IRRELEVANT": return "FIDELITY_ERROR";
    case "E_BINDING": return "BINDING_ERROR";
    case "E_CAPABILITY_UNSUPPORTED": return "CAPABILITY_ERROR";
    case "E_SCHEMA": return "SCHEMA_ERROR";
    default: return "SCHEMA_ERROR";
  }
}
export interface ParseUsage { initial: TokenUsage | null; repair: TokenUsage | null; total: TokenUsage }
export interface ParseCallDiagnostic {
  stage: "A0" | "A1" | "repair";
  raw_text?: string;
  parsed_candidate?: any;
  model?: string;
  finish_reason?: string | null;
  request_id?: string | null;
  usage: TokenUsage | null;
  errors?: ParserError[];
}
export interface ParseOutcome {
  status: "PARSER_ACCEPTED" | "ENGINE_UNSUPPORTED" | "PARSE_FAILED";
  domain: string | null;
  spec: any | null;
  errors: ParserError[];
  repairUsed: boolean;
  repairDelta: number | null;
  usage: ParseUsage;
  cached: boolean;
  diagnostics: ParseCallDiagnostic[];
  compileError?: { code: string; message: string } | null;
}
