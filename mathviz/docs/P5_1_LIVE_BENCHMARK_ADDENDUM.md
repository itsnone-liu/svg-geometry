# MathViz P5.1 Live Benchmark Addendum — DeepSeek V4.1 Flash

- Endpoint: Aliyun Bailian Beijing Token Plan `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- Model ID verified against `/models`: `deepseek-v4.1-flash`
- Credential: user-provided subscription key was passed only to the current PowerShell process as `MATHVIZ_LLM_API_KEY`; never written to files, logs, git, persistent User environment, or printed. (The key was exposed in chat; user should rotate/revoke it after this run.)
- Run: live G18 over all 60 benchmark statements; command returned exit 1 because thresholds were not met.

## Results (live; unlike replay these measure model output)

- Domain accuracy: 98.33% (59/60)
- Final schema + semantic validity: 91.67% (55/60) — threshold ≥98%, FAIL
- Semantic normalized match: 29.63% (16/54 supported cases) — threshold ≥95%, FAIL
- Goal capability accuracy: 100% — threshold ≥95%, PASS
- Supported compile success: 96.30% (52/54) — threshold ≥90%, PASS
- Unsupported correctly surfaced as ENGINE_UNSUPPORTED: 50% (3/6) — target 100%, FAIL
- Repair rate: 6.67% (4/60)
- Answer leakage: 0 — threshold 0, PASS

G18 overall: **FAIL**. Do not interpret replay's 100% as model-quality evidence; this live run provides the relevant first measurement and reveals the gap.

## Observed failure patterns

1. Many outputs validate and compile but differ from the golden semantic-normalized spec (especially geometry and motion). Current summary artifacts record per-case status/errors, not the model's full raw output; do not infer exact error cause from a semantic mismatch alone.
2. A few motion/function cases fail provenance/schema/binding or routing and remain invalid after the single repair.
3. Some unsupported cases were incorrectly accepted as PARSER_ACCEPTED; one unsupported function case was parsed but repair did not recover a valid ProblemSpec.

## Limitations / next action

- This was one live run with a single model configuration. It is diagnostic, not a stable benchmark estimate.
- The current runner does not persist raw model output or token usage per case, so investigate safely by adding redacted structured diagnostics (never credentials) before prompt/normalizer changes.
- The task's engineering thresholds are **not met**; no claim of production readiness or P5.2 completion.
- No Scene/Timeline/P6 work was performed.
