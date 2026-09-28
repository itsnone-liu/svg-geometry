# P5.3 Independent Live Acceptance Protocol — Preregistered

Status: preregistration before live execution.
Benchmark: `mathviz-parser-benchmark/v3` (72 new cases; 24 per domain).
Prompt policy: `p5.3-policy-v1`.
Scope: this protocol authorizes exactly one full independent live acceptance after this document and the v3 freeze are committed. It does not authorize a P5.2/v2 rerun.

## Frozen inputs

- Dataset: `fixtures/parser-bench-v3/cases.json`
- Dataset SHA-256: `6a581071a92015200658d7226dcadb9d68b28d6d595f704fb99329806e514aa8`
- Scoring policy: `docs/P5_3_SCORING_POLICY.md`
- Scoring-policy SHA-256: `e6ae32256f8b296d8cb09beebddbf942ce35c1234b37777a698a2817e9dcaeef`
- Freeze manifest: `fixtures/parser-bench-v3/freeze-v3.json`
- Audit record: `docs/P5_3_GOLDEN_AUDIT.md`
- Goldens: 72/72 pass deterministic full-chain audit. Three domains each have 24 cases. There are exactly six cases in each of the four tagged challenge types.
- Category distribution per domain: 8 straightforward, 4 wording, 4 irrelevant, 4 compositional, 2 unsupported, 2 harder-repair/known-limitation.
- Expected outcomes: 64 `COMPILE_OK`, 6 `ENGINE_UNSUPPORTED`, 2 `KNOWN_LIMITATION_EXPECTED_REJECT`.
- v2 dataset, score policy and frozen hashes are unchanged and remain historical/regression artifacts only.

## Preconditions

1. Run `npx tsc --noEmit`, the complete offline Vitest suite, P0–P5.0 gates, G17, frozen v2 replay, and v3 replay. v2 replay must preserve the historical first-pass G19 calibration of 169/171.
2. Verify `npx tsx packages/parser-benchmark/src/freeze-v3.ts` before the live invocation.
3. Require a secure provider configuration via `MATHVIZ_LLM_BASE_URL`, `MATHVIZ_LLM_API_KEY`, and `MATHVIZ_LLM_MODEL` loaded from the process environment or local `.env`. No credential value may be printed, committed, or copied into task artifacts. A key pasted in chat in the prior P5.2 work is exposed and must never be reused; proceed only with a separately rotated credential. The runner additionally requires the non-secret attestation `MATHVIZ_LLM_KEY_ROTATED_AFTER_P52_EXPOSURE=1`. If the available key cannot be established as fresh/rotated, stop at `LIVE BLOCKED`.
4. Record the provider/model identifier from the configured model name (never the secret), and the preregistration commit hash before starting the single run.

## Run procedure

Invoke `node scripts/run-live-v3.mjs` exactly once. The script runs the deterministic G17 gate and then `run-v3.ts --require-live` over all 72 cases in frozen order. `--require-live` prevents accidental replay from being reported as live. Do not run the P5.2/v2 live scorer.

The runner uses temperature zero and the existing parser contract: one initial parse and at most one bounded repair per case. Provider transport retries are the existing transport-only retry behavior; they do not create a second semantic repair. If a case fails or the process is interrupted, do not selectively rerun cases or repeat the 72-case batch. Preserve every output and diagnostic produced, and report the run as interrupted/failed as appropriate.

## Acceptance thresholds

All criteria are conjunctive. See `P5_3_SCORING_POLICY.md` for exact denominators and challenge rules:

- final schema/semantic-valid expected outcome ≥98% of 72;
- core semantic match ≥95% across the 64 `COMPILE_OK` rows;
- goal capability accuracy ≥95%; supported compile success ≥90%;
- G19 final semantic grounding ≥98.5%;
- all six unsupported cases correctly refused and both known limitations fail closed;
- answer leakage = 0; repair semantic regressions = 0; silent fidelity errors = 0;
- no case uses more than one semantic repair;
- declared-entity, irrelevant-grounded-distractor and expression-term-loss challenges each detected-or-correct = 6/6;
- multi-finding challenges use no second repair and have no repair semantic regression;
- at least 22/24 challenge cases are accepted with core match; the others may only fail closed.

## Prohibited during and after the run

No changes to prompt/few-shot, parser, dataset/goldens, normalizer, scoring policy, thresholds, provider/model, or case ordering once the live run starts. No interim stopping, selective retry, per-case rerun, or second run. A newly discovered golden defect is not fixed in this version: retain this verdict and open a new benchmark version and protocol.

## Result retention

Regardless of PASS, FAIL, LIVE BLOCKED, or interrupted execution, preserve the complete summary, per-case rows, diagnostics, exact provider/model identifier (not key), timestamps, and commit hash. Commit the result and final verdict. If blocked before any provider call due to missing or unverified-safe credentials, record `LIVE BLOCKED` and do not claim live evidence.
