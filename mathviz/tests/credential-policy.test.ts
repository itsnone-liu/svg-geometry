import { describe, expect, it } from "vitest";
import { evaluateCredentialGate } from "../scripts/credential-policy.mjs";

const env = { MATHVIZ_LLM_BASE_URL: "https://example.invalid/v1", MATHVIZ_LLM_API_KEY: "redacted", MATHVIZ_LLM_MODEL: "test-model" };
const disposable = `credential_policy: DISPOSABLE_ACCEPTED\ncredential_risk_acknowledged: true\nscope: P5.3_INDEPENDENT_LIVE_ONLY\naccepted-loss-bound: n/a\nconfirmed-at-utc: 2026-09-28T10:00:00Z\n`;
const strict = `credential_policy: STRICT\ncredential_risk_acknowledged: true\nscope: P5.3_INDEPENDENT_LIVE_ONLY\naccepted-loss-bound: n/a\nconfirmed-at-utc: 2026-09-28T10:00:00Z\n`;
const rotated = `provider-side rotation completed\nconfirmed-at-utc: 2026-09-28T10:00:00Z\n`;

describe("P5.3 operational credential policy", () => {
  it("DISPOSABLE_ACCEPTED requires explicit risk acknowledgement, not rotation", () => {
    const result = evaluateCredentialGate({ policyText: disposable, rotationText: "", env });
    expect(result.policy).toBe("DISPOSABLE_ACCEPTED");
    expect(result.riskAck).toBe(true);
    expect(result.rotationConfirmed).toBe(false);
    expect(result.authorizedBeforeProvider).toBe(true);
  });

  it("STRICT requires rotation proof", () => {
    expect(evaluateCredentialGate({ policyText: strict, rotationText: "", env }).authorizedBeforeProvider).toBe(false);
    expect(evaluateCredentialGate({ policyText: strict, rotationText: rotated, env }).authorizedBeforeProvider).toBe(true);
  });

  it("missing credential blocks both modes and no key value is emitted by the evaluator", () => {
    const result = evaluateCredentialGate({ policyText: disposable, rotationText: "", env: {} });
    expect(result.credentialPresent).toBe(false);
    expect(result.authorizedBeforeProvider).toBe(false);
    expect(JSON.stringify(result)).not.toContain("redacted");
  });
});
