// Credential authorization is operational only; it never changes benchmark scoring.
// Evidence is a human-authored, gitignored attestation file. Environment flags
// are deliberately not accepted as risk acknowledgement or rotation proof.
const REQUIRED_DISPOSABLE = {
  credential_policy: "DISPOSABLE_ACCEPTED",
  credential_risk_acknowledged: "true",
  scope: "P5.3_INDEPENDENT_LIVE_ONLY",
};

function fields(text = "") {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function evaluateCredentialGate({ policyText = "", rotationText = "", env = process.env } = {}) {
  const f = fields(policyText);
  const policy = f.credential_policy || "STRICT";
  const credentialPresent = Boolean(env.MATHVIZ_LLM_BASE_URL && env.MATHVIZ_LLM_API_KEY && env.MATHVIZ_LLM_MODEL);
  const riskAck = REQUIRED_DISPOSABLE.credential_policy === policy
    && f.credential_risk_acknowledged === REQUIRED_DISPOSABLE.credential_risk_acknowledged
    && f.scope === REQUIRED_DISPOSABLE.scope
    && /^.+$/.test(f["accepted-loss-bound"] || "")
    && /^confirmed-at-utc:\s*\d{4}-\d{2}-\d{2}T/im.test(policyText);
  const rotationConfirmed = /^provider-side rotation completed\b/im.test(rotationText)
    && /^confirmed-at-utc:\s*\d{4}-\d{2}-\d{2}T/im.test(rotationText);
  const validPolicy = policy === "STRICT" || policy === "DISPOSABLE_ACCEPTED";
  const policyPass = validPolicy && (policy === "DISPOSABLE_ACCEPTED" || rotationConfirmed);
  return {
    policy,
    validPolicy,
    credentialPresent,
    riskAck,
    rotationConfirmed,
    policyPass,
    authorizedBeforeProvider: policyPass && (policy === "DISPOSABLE_ACCEPTED" ? riskAck : rotationConfirmed) && credentialPresent,
    details: {
      policy: validPolicy ? policy : "invalid",
      riskAck: policy === "DISPOSABLE_ACCEPTED" ? riskAck : "not-required",
      rotation: policy === "STRICT" ? rotationConfirmed : "not-required",
      credentialPresent,
    },
  };
}

export { fields };
