# P5.3 Benchmark v3 Scoring Policy — FROZEN BEFORE LIVE

Version: `mathviz-parser-benchmark/v3`
Scope: 72 fresh cases, 24 per domain; v2 remains immutable historical/regression evidence.
Prompt policy: `p5.3-policy-v1`.
This policy is frozen together with `fixtures/parser-bench-v3/cases.json` by `freeze-v3.json` before the independent live run.

## Expected case classes

- `COMPILE_OK`: accepted, semantically correct cases; count in supported core denominators.
- `ENGINE_UNSUPPORTED`: the parser must refuse through the clean engine-unsupported path.
- `KNOWN_LIMITATION_EXPECTED_REJECT`: predeclared relational-direction limitation; the parser must fail closed with a grounding finding. These rows are reported separately and excluded from the ordinary core-match denominator. They are not retroactively treated as ordinary supported successes/failures.

## Overall live acceptance (all criteria conjunctive)

| Metric | Threshold |
|---|---:|
| Final schema/semantic-valid outcome | ≥ 98% of 72, counting correctly classified expected refusals/rejections as valid outcomes |
| Core semantic match | ≥ 95% over `COMPILE_OK` cases |
| Goal capability accuracy | ≥ 95% |
| Supported compile success | ≥ 90% over `COMPILE_OK` cases |
| G19 final semantic grounding | ≥ 98.5% over claims in accepted payloads |
| Answer leakage | exactly 0 |
| Repair semantic regressions | exactly 0 |
| Silent fidelity errors | exactly 0 |
| Unsupported-case semantic corruption | exactly 0 (unsupported cases must not be mistaken for accepted outputs) |
| Repair budget | at most one per case (structurally enforced and reported) |

## Challenge acceptance

There are 24 challenge cases: exactly six each tagged `declared-entity-completeness`, `irrelevant-grounded-distractor`, `expression-term-loss`, and `multi-finding-one-repair`.

- For each of the first three challenge types, detected-or-correct must be 6/6: either the final accepted payload core-matches the audited golden, or the system detects a fidelity/grounding error and fails closed after its single repair. A wrong payload accepted without a fidelity/grounding finding is silent and fails.
- Across the 24 challenge cases, at least 22 must end accepted with core semantic match; the remainder may fail closed but must not be silently accepted wrong.
- For multi-finding challenges: no second repair, no repair semantic regression, and no silent accepted semantic error. G20 and G19 findings must be aggregated before the one repair call.

## G20 metrics

Report `declared_entity_completeness`, `expression_fidelity`, `goal_relevance_precision`, `silent_fidelity_error_count`, and `fidelity_repair_success_rate` alongside G19's existing metrics. G20 is a bounded deterministic verifier; expressions outside the frozen Function2D subset are `N/A` and must not be represented as checked-success.

## Freeze and post-run discipline

Before live: complete human and programmatic golden audits; record SHA-256 hashes for this policy and the 72-case dataset; commit the freeze and preregistration. During the single independent live run: no prompt/few-shot/golden/normalizer/threshold edits, no interim stopping, and no per-case retries. Commit the complete PASS or FAIL verdict and diagnostics either way. Once the run starts, neither v3 goldens nor this policy may be edited in response to results; a discovered golden defect gets a new benchmark version and new protocol.
