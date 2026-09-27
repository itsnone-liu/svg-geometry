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
| Provenance spans actually support their quoted source text | 100% | pass |
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
- No prompt optimization phase was run. Do not proceed to P5.1b until review of the raw diagnostic artifact and acceptance of this scoring policy.
- Golden audit after correction: 60 cases remain (20/domain); all supported-case provenance spans slice exactly from their statements; no declared `f(x)=...` function is absent from its golden.
- Offline regression: `npx tsc --noEmit`, 181 tests, P5.0 gates and replay G18 pass.
- No Scene/Timeline/P6 work was performed.
