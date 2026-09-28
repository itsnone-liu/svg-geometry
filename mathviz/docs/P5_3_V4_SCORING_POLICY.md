# P5.3 v4 Scoring Policy

Status: C2.2 candidate policy. This policy is provider-free and must be frozen before C2.3 manifest generation.

## Fixed denominators

| Population | Denominator |
|---|---:|
| All cases | 72 |
| `COMPILE_OK` | 64 |
| `ENGINE_UNSUPPORTED` | 6 |
| `KNOWN_LIMITATION_EXPECTED_REJECT` | 2 |
| Goal-capability eligible | 70 = 64 + 6 |
| Function dual cases | 15 |
| Bare-equation controls | 9 |

The scorer reads these populations from declarations and asserts the fixed counts. It never reclassifies denominators from observed outcomes.

## Final candidate

`finalCandidate` is the repair candidate when exactly one repair occurred; otherwise it is the A1 candidate. Semantic core, goal capability, unsupported semantic corruption, and G20 diagnostics use `finalCandidate` where present. `out.spec` is used only for parser-accepted outcome metrics.

## Overall gates

- `final_schema_semantic_valid >= 98%` over 72.
- `core_semantic_match >= 95%` over the 64 declared `COMPILE_OK` cases.
- `supported_compile_success >= 90%` over 64.
- `goal_capability_accuracy >= 95%` over 70 non-known-limitation cases, evaluated from `finalCandidate`, including engine-unsupported cases.
- Correct engine refusal: exactly 6/6.
- Correct known-limitation rejection: exactly 2/2.
- G19 final grounding `>= 98.5%`.
- Unsupported semantic corruption = 0.
- Answer leaks = 0.
- Repair semantic regressions = 0.
- Silent fidelity errors = 0.
- Maximum repair calls per case <= 1.

## v4 structural gates

### Function duality

For the 15 declared dual cases:

- `dual_detected_or_correct = 15/15`: either final semantic core matches the golden or G20-D/fidelity gating detects the defect and fails closed.
- `dual_accepted_core_match >= 14/15`.
- Any silently accepted incorrect dual structure is a global failure.

### Bare-equation controls

For the 9 function2d cases without a function entity:

- `bare_equation_overconstraint = 0/9`.
- G20-D must not require a function entity.

## Diagnostic-only metrics

The following remain reported but are not acceptance denominators:

- declared entity completeness;
- expression fidelity;
- goal relevance precision;
- fidelity repair success rate;
- legacy `category` and `challengeType` fields.

The mechanically cycled `category`/`challengeType` fields are non-authoritative for v4 acceptance.

## Declaration authority

Expected class, stage, error, failure family, fixed populations, and this policy are designer-authored declarations. Actual outcomes are compared to them and may never rewrite them.

## Freeze boundary

This document is a C2.2 candidate only. No provider call, live authorization, freeze manifest, preregistration, or freeze verdict is authorized by this policy alone.
