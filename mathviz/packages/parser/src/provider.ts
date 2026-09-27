// StructuredLLMProvider implementations:
//   OpenAICompatibleProvider — live mode over any OpenAI-compatible chat
//     API (DeepSeek/Qwen/vLLM...), configured purely by environment:
//     MATHVIZ_LLM_BASE_URL / MATHVIZ_LLM_API_KEY / MATHVIZ_LLM_MODEL.
//   ScriptedProvider — deterministic queue of raw replies, for G17 contract
//     tests (invalid outputs, fence-stripping, repair flows). Zero tokens.
//   GoldenProvider — benchmark replay mode: returns the dataset's frozen
//     golden answers, validating the pipeline end-to-end without a live
//     model. Replay numbers are engineering plumbing checks, NOT model
//     quality claims.

import { ProviderError, type LlmGenerateRequest, type LlmGenerateResult, type StructuredLLMProvider, type TokenUsage } from "./types";

const ZERO: TokenUsage = { input_tokens: 0, output_tokens: 0 };

// Bounded transport retry (2026-09-27 P5.1b live run evidence): 10/60 cases
// died on transient "fetch failed" (stale keep-alive socket / short network
// outage windows) and each burn silently consumed that case's A1+repair.
// We retry ONLY transport-level conditions — fetch throw, or HTTP 429/5xx.
// E_JSON and non-retryable 4xx (auth/validation) surface immediately.
// Scoring semantics are untouched: a retried request is the same single A1
// (+<=1 repair) call from the pipeline's point of view.
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2_000, 8_000, 20_000, 45_000];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isTransientTransportError(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return false;
  // Network-level wrapper thrown below on fetch rejection.
  if (e.code === "E_PROVIDER" && e.message.startsWith("LLM request failed:")) return true;
  if (e.code === "E_HTTP") {
    const m = /^LLM HTTP (\d+)/.exec(e.message);
    if (m) return RETRYABLE_HTTP.has(Number(m[1]));
  }
  return false;
}

function extractJsonText(raw: string): string {
  // Models are told JSON-only (P5.1 §16); defensively strip markdown fences.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(raw.trim());
  return fenced ? fenced[1]! : raw.trim();
}

export class OpenAICompatibleProvider implements StructuredLLMProvider {
  readonly id: string;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string
  ) {
    this.id = `openai-compat:${model}`;
  }

  static fromEnv(): OpenAICompatibleProvider | null {
    const baseUrl = process.env.MATHVIZ_LLM_BASE_URL;
    const apiKey = process.env.MATHVIZ_LLM_API_KEY;
    const model = process.env.MATHVIZ_LLM_MODEL;
    if (!baseUrl || !apiKey || !model) return null;
    return new OpenAICompatibleProvider(baseUrl.replace(/\/+$/, ""), apiKey, model);
  }

  async generate<T>(req: LlmGenerateRequest): Promise<LlmGenerateResult<T>> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attemptOnce<T>(req);
      } catch (e) {
        if (!isTransientTransportError(e) || attempt >= RETRY_DELAYS_MS.length) throw e;
        // Back off, then re-dial (a fresh connection also sidesteps any
        // stale pooled keep-alive socket that caused the failure).
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  private async attemptOnce<T>(req: LlmGenerateRequest): Promise<LlmGenerateResult<T>> {
    let resp: any;
    try {
      resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${req.system}\n\nOutput JSON only. The output must satisfy this JSON Schema:\n${JSON.stringify(req.schema)}` },
            { role: "user", content: req.input }
          ]
        })
      });
    } catch (e: any) {
      throw new ProviderError(`LLM request failed: ${e?.message ?? e}`);
    }
    if (!resp.ok) throw new ProviderError(`LLM HTTP ${resp.status}`, "E_HTTP", { model: this.model, request_id: resp.headers?.get?.("x-request-id") ?? null }, { ...ZERO });
    const body = await resp.json();
    const text: string = body?.choices?.[0]?.message?.content ?? "";
    const u = body?.usage;
    const usage = { input_tokens: u?.prompt_tokens ?? 0, output_tokens: u?.completion_tokens ?? 0 };
    const diagnostics = {
      raw_text: text,
      model: body?.model ?? this.model,
      finish_reason: body?.choices?.[0]?.finish_reason ?? null,
      request_id: body?.id ?? resp?.headers?.get?.("x-request-id") ?? null
    };
    let value: T;
    try {
      value = JSON.parse(extractJsonText(text)) as T;
    } catch {
      throw new ProviderError("LLM output was not valid JSON after fence stripping", "E_JSON", diagnostics, usage);
    }
    return { value, usage, model: diagnostics.model, diagnostics };
  }
}

/** Deterministic scripted replies — each generate() pops the front reply. */
export class ScriptedProvider implements StructuredLLMProvider {
  readonly id = "scripted";
  calls = 0;
  readonly requests: LlmGenerateRequest[] = [];
  constructor(private replies: Array<string | Error>) {}

  async generate<T>(_req: LlmGenerateRequest): Promise<LlmGenerateResult<T>> {
    this.calls++;
    this.requests.push(_req);
    const next = this.replies.shift();
    if (next === undefined) throw new ProviderError("scripted provider exhausted");
    if (next instanceof Error) throw next;
    const diagnostics = { raw_text: next, model: "scripted", finish_reason: "stop", request_id: null };
    try {
      const clean = extractJsonText(next);
      return { value: JSON.parse(clean) as T, usage: { ...ZERO }, model: "scripted", diagnostics };
    } catch {
      throw new ProviderError("scripted output was not valid JSON", "E_JSON", diagnostics, { ...ZERO });
    }
  }
}

export interface GoldenCase {
  statement: string;
  domain: string;
  /** Validated golden ProblemSpec. */
  golden: any;
}

/** Replay provider: answers A0 (domain) and A1 (spec) from the dataset. */
export class GoldenProvider implements StructuredLLMProvider {
  readonly id = "golden-replay";
  calls = 0;
  private byStatement = new Map<string, GoldenCase>();
  private currentCase: GoldenCase | null = null;
  constructor(cases: GoldenCase[]) {
    for (const c of cases) this.byStatement.set(c.statement, c);
  }
  select(statement:string):void { this.currentCase=this.byStatement.get(statement)??null; }

  async generate<T>(req: LlmGenerateRequest): Promise<LlmGenerateResult<T>> {
    this.calls++;
    // A0 domain-routing calls embed the statement; A1 calls too. Find the
    // longest dataset statement contained in the input (wording-stable).
    let best: GoldenCase | null = this.currentCase;
    if (!best) for (const c of this.byStatement.values()) {
      if (req.input.includes(c.statement) && (!best || c.statement.length > best.statement.length)) best = c;
    }
    if (!best) throw new ProviderError("golden provider: statement not in dataset");
    // A0 (domain routing) vs A1 (spec): the A0 schema is the tiny
    // {required:["domain"]} object; the A1 schema is the full ProblemSpec.
    const isDomainCall = Array.isArray((req.schema as any)?.required) && (req.schema as any).required.length === 1 && (req.schema as any).required[0] === "domain";
    const value = isDomainCall ? { domain: best.domain } : best.golden;
    return { value: value as T, usage: { ...ZERO }, model: "golden-replay", diagnostics: { raw_text: JSON.stringify(value), model: "golden-replay", finish_reason: "stop", request_id: null } };
  }
}

export { extractJsonText };
