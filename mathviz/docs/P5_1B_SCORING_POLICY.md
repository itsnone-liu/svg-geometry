# P5.1b benchmark and scoring policy — v2

This policy and the dataset are frozen before the independent P5.1b live run. Do not alter either after inspecting that run's model output. Any later correction requires a new dataset/scoring version and independent run.

## Dataset and evidence

- `fixtures/parser-bench/cases.json`: version 2, 60 cases, 20 per domain.
- P5.1a captured output is excluded from independent-run evidence. Rescoring it against corrected goldens is calibration only.
- `fixtures/parser-bench/freeze-v2.json` pins dataset and policy SHA-256; the runner verifies them before any request.
- Before freeze, supported motion facts cite the relevant number/unit/entity phrase. `mo_wd_05` retains shared opposing-motion wording without per-body sign inference; its vB and body-B semantic claims fail closed.

## G19 measures and denominator

G19 keeps two separate measures:

1. **Slice validity**: source span exactly slices the frozen statement, and candidate statement equals the case statement.
2. **Semantic grounding**: claimed payload is supported by deterministic rules below. Slice validity is never evidence of semantic support.

Semantic denominator is entity and source-fact payload claims from supported expected cases that yield a ProblemSpec. Unsupported expected cases are N/A for semantic grounding; their slice validity is still reported. Constraints are excluded until a payload-specific verifier exists. Parse/validation failures remain covered by G18 validity gates. Reports provide numerator and denominator; a zero-payload candidate is only a vacuous pass.

## Bounded deterministic rules

- **Facts/units:** the exact numeric value must be adjacent to a recognized whole unit in the cited slice. ASCII unit boundaries are enforced (`m` must not match the prefix of `mm`). Units are family-specific; e.g., speed cannot ground distance. Each number+unit occurrence can ground only one fact. Unsupported units/encodings fail closed.
- **Motion:** a velocity sign requires an explicit signed literal or, for an unsigned magnitude, a recognized direction cue local to the number/unit clause. Positive/reverse cues are not inferred from unrelated clauses; unsigned magnitude alone cannot support a signed fact. `相向而行` is a shared relation, not a frozen body-role-to-sign mapping, and fails closed. Zero speed requires explicit stationary wording. A body slice must cover its linked facts.
- **Geometry:** a point label and ordered coordinate pair must co-occur in a constrained local phrase. A segment/line requires a nonempty cited label or both endpoint points independently grounded and referenced in that same cited slice; whole-statement lookups cannot substitute.
- **Expressions/equations:** supported AST numbers, symbols, and operators must be evidenced in the cited slice. Equation RHS is checked as well as LHS. Equality or a closed, recognized implicit goal/relation is required; words such as `根据` alone are not a goal. Composite RHS without explicit equality fails closed. Function entities require a function-name/equality anchor. The narrow zero-set exception applies only when an equation's LHS exactly matches an explicitly declared function expression in a valid source slice, its RHS is exactly numeric zero, and the evidence includes that function declaration and explicit zero-set request.
- Constraints are excluded until a payload-specific verifier exists. Unsupported AST/entity forms are counted as ungrounded for supported-case payloads.

These are deliberately bounded lexical/structural rules, not general NLP entailment or algebraic theorem proving.

## Threshold and case treatment

- G19 threshold: at least 98.5% semantic grounding across applicable candidate payloads, with per-path findings and numerator/denominator. Frozen goldens calibrate at 169/171 (98.83%); exactly two known `mo_wd_05` shared-opposition claims remain ungrounded and in denominator.
- Unsupported-case semantic grounding is N/A and excluded; unsupported refusal is separately measured by G18.
- Core semantic match, goal/entity/fact/expression layers, supported compile, unsupported refusal, and answer leakage retain their G18 thresholds and are not substitutes for G19.
