# P5.3 Live Acceptance — LIVE BLOCKED

## Attempt 1: credential freshness was not attested

- Date: 2026-09-28
- Preregistration commit: `00a75d3bab7de1f9152da7fddf7fe5adfc103276`
- Frozen dataset SHA-256: `6a581071a92015200658d7226dcadb9d68b28d6d595f704fb99329806e514aa8`
- Frozen scoring-policy SHA-256: `e6ae32256f8b296d8cb09beebddbf942ce35c1234b37777a698a2817e9dcaeef`
- Gate invocation: `npm run gates:p53:live`
- Gate result: runner exited before G17 or any provider call because the configured key's freshness/rotation was unattested.

The local ignored `.env` contains provider configuration, but available evidence did not establish that its key differs from the P5.2 key exposed in chat. No key value was printed, copied into source, or committed. The one-run protocol explicitly prohibited reuse of that exposed key; therefore no provider request was made.

## Attempt 2: stale scoring-policy freeze stopped the run before model calls

The user subsequently stated that the key had been rotated. A single guarded runner invocation was started with the non-secret rotation attestation set for that process. G17 passed, but the v3 runner's preflight rejected a SHA-256 mismatch between the committed scoring-policy freeze (`e6ae3225…`) and the policy file bytes as read at runtime (`2c870cfc…`). This occurred before any P5.3 A1/repair call; the model was not invoked and no benchmark cases ran. The discrepancy is consistent with line-ending normalization between the committed and runtime policy bytes; regardless, the freeze verifier correctly stopped the run. Per the preregistered no-post-start freeze rule, do not patch the hash and retry this version or resume the 72-case batch.

## Disposition

**P5.3 live verdict: BLOCKED / NOT RUN.** There are no model-quality results. The earlier deterministic engineering replay is not live evidence. Retain both recorded attempts as the audit trail. The scoring policy, dataset and original preregistration remain unchanged in the committed benchmark version; a live run requires a new benchmark/protocol version and preregistration because the scoring-policy bytes differ from the committed freeze. Do not rerun this batch, selectively retry, or silently update the manifest under the existing protocol.

Offline evidence before the attempts remains: TypeScript passed; Vitest 215/215; full P0–P5.0 gates green; G17 PASS; v2 replay retains first-pass G19 calibration 169/171; v3 deterministic replay PASS against the pre-run frozen contract.
