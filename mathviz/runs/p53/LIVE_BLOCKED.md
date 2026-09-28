# P5.3 Live Acceptance — LIVE BLOCKED

- Date: 2026-09-28
- Preregistration commit: `00a75d3bab7de1f9152da7fddf7fe5adfc103276`
- Frozen dataset SHA-256: `6a581071a92015200658d7226dcadb9d68b28d6d595f704fb99329806e514aa8`
- Frozen scoring-policy SHA-256: `e6ae32256f8b296d8cb09beebddbf942ce35c1234b37777a698a2817e9dcaeef`
- Mode: no live provider request issued.
- Gate invocation: `npm run gates:p53:live`
- Gate result: `LIVE BLOCKED` before G17 and before any provider call.

## Concrete blocker

The local ignored `.env` contains provider configuration fields, but available evidence does not establish that its API key is different from the P5.2 key previously exposed in chat. The key must not be reused. No key value was read into output, copied into source, or added to version control. The non-secret rotation attestation `MATHVIZ_LLM_KEY_ROTATED_AFTER_P52_EXPOSURE=1` was absent from both process environment and `.env`; the guarded runner exited before contacting a provider.

This is a credential-safety blocker, not a parser/benchmark failure. Do not describe replay as live acceptance. No live results exist.

## Offline evidence

- TypeScript: `npx tsc --noEmit` passed.
- Vitest: 215/215 passed.
- P0–P5.0 `npm run gates`: all green.
- G17 parser contract: PASS, including s13/s14 G20+G19 aggregation and one-repair constraints.
- Frozen v2 replay: PASS; first-pass G19 calibration remains 169/171; v2 dataset/policy unchanged.
- V3 golden audit: 72/72 expected outcomes; frozen quotas and challenge distribution verified.
- V3 engineering replay: PASS (64/64 core matches; 6/6 unsupported refusals; 2/2 known-limit expected rejects; all challenge checks pass). This is deterministic pipeline replay, not model-quality or live evidence.
- Frozen hashes verified after preregistration.

## Resume condition

After the P5.2-exposed key has been rotated at the provider, inject the replacement through a secure environment channel and explicitly set the non-secret rotation attestation. Verify the existing freeze; do not edit v3 goldens, policy, thresholds, or prompt. Then run the guarded preregistered v3 acceptance exactly once. Any new live protocol or benchmark changes require a new version and preregistration.
