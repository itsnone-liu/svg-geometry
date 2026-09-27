# MathViz P5.1a Live Benchmark Addendum — DeepSeek V4.1 Flash

## Run provenance and safety

- Endpoint: Aliyun Bailian Beijing Token Plan `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- Model ID: `deepseek-v4.1-flash`
- One live run across the 60-case benchmark; parse-repair remains capped at one repair.
- The credential was supplied only as a process environment value. Artifacts record model text, request IDs, per-call token counts and candidates, but contain no Authorization headers or API key. The exposed chat credential should be revoked/rotated.
- Detailed (sensitive benchmark text/model output) diagnostics are local under ignored `runs/p51/benchmark-diagnostics.json`; the summary is in `runs/p51/benchmark.json`. Do not commit raw diagnostics.

## Calibrated result

The original P5.1 goldens incorrectly omitted the explicit `f(x)=x^2-9` function entity in `fx_wd_01`, although the statement directly declares it. This was corrected after reviewing the captured candidate. The saved live run was then rescored against the corrected golden; this is **not** a second model request/run.

| Metric | Live result | Status |
|---|---:|---|
| Domain accuracy | 100% (60/60) | pass |
| Final schema/semantic validity | 100% (60/60) | pass |
| Core semantic match | 100% (54/54 supported) | pass |
| Goal semantics | 100% | pass |
| Entity graph | 100% | pass |
| Numerical facts | 100% | pass |
| Expressions | 100% | pass |
| Provenance span text match vs golden | 36.67% | diagnostic; not a core-semantic failure |
| Provenance slice validity (`slice_valid`) | 100% in the calibrated P5.1a capture | only confirms exact cited substring and statement match; does not establish payload grounding |
| Provenance semantic grounding (`semantic_grounded`) | not measured by P5.1a | added in P5.1b; no live result yet |
| Goal capability accuracy | 100% | pass |
| Supported compile success | 100% (54/54) | pass |
| Unsupported correctly refused | 100% (6/6) | pass |
| Unsupported semantic corruption | 0 cases | pass |
| Repair rate | 6.67% (4/60) | diagnostic |
| Answer leakage | 0 | pass |

Token usage: 262,904 input and 185,973 output tokens total; per-case averages 4,382 input / 3,100 output (rounded). The thresholded G18 live gate passes after the golden correction. This is one sample, not a confidence interval or proof of general model reliability.

## Diagnostic interpretation

- The low exact provenance-span textual agreement reflects valid alternate evidence spans, not unsupported spans: every captured entity/fact/constraint span slices back to its statement text. Provenance remains a separate score and must not contaminate core expression/fact/goal correctness.
- All four prior observed unsupported/repair failures were resolved by the full-candidate, structured-error repair contract: `fx_un_02`, `mo_sf_08`, `mo_wd_03`, `mo_un_01`, and `mo_un_02` now route/parse/refuse as expected (note four repairs across these cases; the list contains five cases).
- No prompt optimization phase was run. This remains a single P5.1a observation; its rescore is calibration, not independent replication.
- P5.1b adds a deterministic G19 verifier and freezes dataset/policy hashes before any independent run. The offline calibration fixture result is 169/171 (98.83%): two `mo_wd_05` shared-opposition per-body sign claims fail closed; unsupported cases are N/A for semantic grounding. This is golden-fixture calibration only, not model evidence. Current credentials are absent, so no fresh live replication has been performed.
- Golden audit after correction: 60 cases remain (20/domain); all supported-case provenance spans slice exactly from their statements; no declared `f(x)=...` function is absent from its golden.
- P5.1a offline regression at time of that commit: `npx tsc --noEmit`, 181 tests, P5.0 gates and replay G18 pass. P5.1b current offline verification: `npx tsc --noEmit`, 199 tests, P5.0 and replay G18/G19 pass. Fresh live credentials remain absent; the guarded live command refuses replay as live evidence.
- No Scene/Timeline/P6 work was performed.

## P5.1b independent live runs (2026-09-28)

Credentials were supplied by the user as a local gitignored `.env` (loaded by `scripts/run-live.mjs` via `NODE_OPTIONS`; Windows does not propagate HKCU env to non-shell children). Two live runs were performed against the frozen v2 dataset/policy (`dataset c77c1714…`, `policy a4d91ba0…`, verified by the runner before any request).

**Run 1 (network-degraded, not gate evidence).** 10/60 cases died on transient transport errors (`LLM request failed: fetch failed`), each silently consuming that case's A1+repair; every case that received a model response passed (46/46 core match, G19 134/136). The benchmark summary was archived locally as `runs/p51/benchmark.live1-network-degraded.json`. Fix: bounded transport retry in `OpenAICompatibleProvider` (fetch throw / HTTP 429/5xx only; backoff 2/8/20/45 s, 4 retries; E_JSON and other 4xx fail immediately). Transport hardening does not alter dataset, goldens, scoring policy, or per-case call semantics.

**Run 2 (gate evidence).**

| Metric | Live result | Status |
|---|---:|---|
| Domain accuracy | 100% (60/60) | pass |
| Final schema/semantic validity | 100% (60/60) | pass |
| Core semantic match | 98.15% (53/54) | pass (threshold 95%) |
| Goal capability accuracy | 100% | pass |
| Supported compile success | 100% (54/54) | pass |
| Unsupported correctly refused | 100% (6/6) | pass |
| Unsupported semantic corruption | 0 | pass |
| G19 provenance slice validity | 100% | pass |
| **G19 semantic grounding** | **97.06% (165/170)** | **FAIL (threshold 98.5%)** |
| Repair rate | 8.33% (5/60) | diagnostic |
| Answer leakage | 0 | pass |

Token usage: 263,184 input / 186,929 output. The single core mismatch (`fx_wd_01`) omitted the explicitly declared `f(x)=x²-9` function entity this sample; goal routing and grounding were unaffected.

**G19 failure analysis (all five ungrounded claims enumerated):**

1. `mo_wd_05` fact `vB` — the known frozen-policy fail-closed case (signed speed inferred from the shared `相向而行` relation; expected).
2. `mo_wd_05` entities `A`, `B` — the model widened the shared-clause fact spans (vA/vB cite from `相向而行：` onward), so each body slice no longer covers its linked fact's cited span.
3. `geo_wd_01` segment `PQ` — model cited `P 与 Q` (names both endpoints, no coordinates); the golden cites the full two-coordinate phrase.
4. `geo_wd_05` segment `school_library` — model cited the anaphor `两地的直线距离`.

Claims 2–4 are alternate evidence spans a human would accept but the bounded frozen verifier does not (no endpoint coordinates in the segment slice; body slice no longer containing the widened fact slice). The verifier implements the frozen v2 policy faithfully; no verifier change was made after inspecting run output. Consequence: **the live G18 gate is recorded as FAIL on G19 (97.06% < 98.5%)**; all remaining thresholds pass with margin. Honest options forward, without touching frozen v2: (a) accept and document this as the P5.1b live boundary; (b) author scoring policy v3 with a pre-declared segment rule extension (endpoint-name references with endpoints independently grounded in their own slices) and run a fresh independent benchmark; (c) P5.2 grounding-guided repair (feed grounding findings into the bounded repair loop). No option was exercised in this commit.
