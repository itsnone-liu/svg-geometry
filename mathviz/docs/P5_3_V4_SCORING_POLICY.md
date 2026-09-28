# P5.3 v4 Scoring Policy

Status: C2.2 candidate policy. This policy is provider-free and must be frozen before C2.3 manifest generation.

C2.2 denominator decision CLOSED (2026-09-28): the dual accepted-core denominator is `DUAL_COMPILE_OK = 11` (= `DUAL_ALL` ∩ `COMPILE_OK`). `13` has no valid set definition and `15` is not an accepted denominator; neither may be used. Dual scoring is fully split by expected class below.

## Fixed denominators

| Population | Denominator |
|---|---:|
| TOTAL | 72 |
| `COMPILE_OK` | 64 |
| `ENGINE_UNSUPPORTED` | 6 |
| `KNOWN_LIMITATION_EXPECTED_REJECT` | 2 |
| Goal-capability eligible | 70 = 64 + 6 |
| DUAL_ALL (function dual cases) | 15 |
| DUAL_COMPILE_OK | 11 = 15 - 2 - 2 |
| DUAL_ENGINE_UNSUPPORTED | 2 |
| DUAL_KNOWN_LIMITATION | 2 |
| Bare-equation controls | 9 |

`DUAL_ACCEPTANCE_ELIGIBLE = DUAL_ALL ∩ COMPILE_OK = DUAL_COMPILE_OK = 11`. The 2 `DUAL_ENGINE_UNSUPPORTED` and 2 `DUAL_KNOWN_LIMITATION` dual cases are correctness populations (gates B/C below), never acceptance populations.

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

The 15 declared dual cases are scored as three disjoint expected-class subpopulations. There is no aggregate dual-accepted denominator.

**A. `dual_compile_ok_accepted_core = 11/11`** over `DUAL_COMPILE_OK`. For each of the 11 dual cases with `expected_class = COMPILE_OK`:

- final status = `PARSER_ACCEPTED`; and
- `finalCandidate` semanticEqual golden.

**B. `dual_engine_unsupported_correct = 2/2`** over `DUAL_ENGINE_UNSUPPORTED`. These cases are never accepted; the parser must demonstrably understand them while the deterministic engine refuses to compile:

- final status = `ENGINE_UNSUPPORTED`;
- `finalCandidate` semanticEqual golden;
- compile refusal code equals the declared `expected_error`; and
- parser-owned error count = 0.

**C. `dual_known_limitation_correct = 2/2`** over `DUAL_KNOWN_LIMITATION`. These cases are never accepted:

- final status = `PARSE_FAILED`;
- declared `expected_stage = G19`, `expected_error = E_PROVENANCE_GROUNDING`;
- exactly one final error equal to the declared `expected_error`; and
- observed failure family matches the declared `expected_failure_family` (`function_zero_bad_provenance`).

Gate A is exact 11/11, not >= 10/11: P5.3 v4 exists specifically to close the dual-representation gap, and all 11 are declared `COMPILE_OK` targeted supported cases — a live miss means the gap is not closed. The global 64-sample tolerance gates (>= 95% / >= 90%) are unchanged and independent.

Safety totals retained across all 15 dual cases:

- `dual_detected_or_correct = 15/15`: either final semantic core matches the golden or G20-D/fidelity gating detects the defect and fails closed.
- Any silently accepted incorrect dual structure is a global failure.

Parser-owned error codes for gate B: `E_SOURCE_COMPLETENESS`, `E_SOURCE_EXPRESSION_LOSS`, `E_SOURCE_IRRELEVANT`, `E_FUNCTION_ZERO_FUNCTION_MISSING`, `E_FUNCTION_ZERO_EQUATION_MISSING`, `E_FUNCTION_ZERO_GOAL_BINDING`, `E_PROVENANCE`, `E_PROVENANCE_GROUNDING`, `E_BINDING`.

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
