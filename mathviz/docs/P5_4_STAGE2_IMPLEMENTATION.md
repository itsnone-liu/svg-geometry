# P5.4 Stage-2 Implementation — Complete

**Authority:** owner authorization 2026-09-29 (four fixed phases 2A→2B→2C→2D; span relaxation / v4 fixture-golden-verdict-freeze modification / f_03 reinterpretation / provider requests / live sampling all FORBIDDEN and all avoided). Zero provider requests issued. Zero modifications to any v3/v4 shared pipeline file — every change lives in new v5 modules, so the 13 frozen v4 blobs and the v3 code paths stay byte-identical.

## Delivered modules

| Phase | File | What it does |
|---|---|---|
| 2A | `packages/parser/src/identity-v5.ts` | Strict source-identity contract: an explicit `f(x)=…` declaration requires the function entity to carry the canonical `label:"f"`; internal ids (`u_func`/`fn_u`/`function_17`) are not substitutes. Emits the precise **`E_FUNCTION_DECLARATION_LABEL_MISSING`** at `/entities/<id>/label` with hint *"Set this function entity's label to the explicitly declared source function name. Do not modify goal.inputs."* While active, the derived cascade (`E_SOURCE_COMPLETENESS`, `E_SOURCE_IRRELEVANT`, `E_FUNCTION_ZERO_FUNCTION_MISSING`, and that entity's `E_PROVENANCE_GROUNDING`) is suppressed with the count recorded — one root cause, one error, one minimal repair action, never silent. |
| 2A | `packages/parser/src/prompt-v5.ts` | vNext overlay: v4 dual-representation guidance + the identity-contract clause (historical v4/v3 prompts untouched). |
| 2B | `packages/parser/src/repair-v5.ts` | Deterministic mutation audit: a conforming, non-implicated `solve_equation` goal's `inputs` must survive repair byte-identically. Violations are **projected back** from A1; the raw model candidate, the projected candidate, and `protected_paths_restored` are all recorded (`model_repair_candidate` / `projected_candidate` / `protected_paths_restored` / `audit_notes`). An entity-kind rewrite sidestep guard protects the equation entity table too. |
| 2C | `packages/parser/src/identity-v5.ts` | **`E_FUNCTION_ZERO_GOAL_OVERREFERENCE`**: `function2d.solve_equation` inputs must be EXACTLY `[equation]`. All four owner-listed shapes fail: `[equation,function]`, `[function,equation]`, `[equation,equation2]`, `[equation,arbitrary_entity]`. Monotonicity becomes the first line of defense, this deterministic verifier the second. |
| 2D | `packages/parser/src/grounding-v5.ts` | G19 function-anchor special case fixed as **correctness debt, NOT the v4 live-regression root cause** (Stage-1.1 already pinned that on label omission): argument order corrected (slice ↔ declared label were reversed in the frozen file), hardcoded `"^2"`/`"x^2"` substring evidence replaced by canonical-AST power-form evidence + actual declared name anchor + zero-request semantics. Exact-source-slice strictness untouched (the wrapper can only re-adjudicate the function-entity anchor verdict on valid exact slices). |
| — | `packages/parser/src/parse-v5.ts` | v5 pipeline: identity → fidelity → compile → grounding-v5 with suppression bookkeeping; repair path runs the mutation audit before the second gate pass and records the audit in diagnostics. |
| — | `packages/parser-benchmark/src/gates-p54.ts` | Stage-3 acceptance gate runner over the frozen live evidence. |
| — | `tests/p54-stage2.test.ts` | 13 regression tests on real golden-derived shapes. |

## Acceptance evidence (owner-specified)

- **G-P54-1 PASS (10/10)** — historical regression A1s + canonical-label counterfactual through `attemptCompileV5`: 8 supported cases `PARSER_ACCEPTED`; v4_f_01/f_02 clean `ENGINE_UNSUPPORTED` with parser-owned errors = 0 (only their declared `expected_error` remains).
- **G-P54-2 PASS (10/10)** — every historical destructive repair mutation is caught: verdict `projected`, `/goals/<id>/inputs` restored. End-to-end (v4_f_02): audit projection of the recorded repair yields the correct `ENGINE_UNSUPPORTED` terminal state.
- **G-P54-3 PASS** — silent goal-input over-reference accepted = 0. v4_f_05 flips from the v4 silent `PARSER_ACCEPTED` drift to deterministic `PARSE_FAILED` with `E_FUNCTION_ZERO_GOAL_OVERREFERENCE`.
- **tsc 0 errors · vitest 241+13 = 254/254 PASS · v3 frozen evidence replay PASS (11 checks incl. `repair_semantic_regressions_zero`) · v4 golden scorer replay PASS** — v3/v4 frozen code paths provably untouched.
- **72-case v4-evidence counterfactual replay** (`runs/p53/v4-gates-p54.json`): 70/72 identical terminal states; the 2 changes (v4_f_02, v4_f_05) are exactly the over-reference detector firing on the recorded destructive repairs. This is **counterfactual remediation evidence ONLY — the v4 live verdict stays FAIL @ 8b10a766 and is never rewritten.**

## Status

```
P5.4 Stage-2A identity contract      COMPLETE
P5.4 Stage-2B repair monotonicity    COMPLETE
P5.4 Stage-2C over-reference gate    COMPLETE
P5.4 Stage-2D G19 correctness debt   COMPLETE
P5.4 Stage-3 acceptance              PASS (G-P54-1/2/3 + full suite)
span relaxation                      NOT DONE (forbidden — G19 exact slices preserved)
provider / live                      NONE (forbidden)
```

Next per the owner's chain: Stage-4 new benchmark design (f_03 expectation reclassification, fresh cases) → new freeze → new preregistration → new live authorization. Held for owner ruling.
