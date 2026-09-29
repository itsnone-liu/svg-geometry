# P5.4 Stage-1 Offline Forensics — v4 Independent Live FAIL

> **ERRATUM (Stage-1.1, counterfactual audit):** §2's causal attribution to the equation-span slice difference is **refuted**. The owner's remote re-audit found 10/10 A1 function entities lack `label` (golden has it); counterfactual replay shows adding ONLY the golden `function.label` clears all four fidelity/G19 errors in 10/10 (CF1), while replacing ONLY the equation span clears 0/10 (CF2). Primary cause = named-function identity omission; the span difference was a confounding correlate. See `docs/P5_4_STAGE1_1_COUNTERFACTUAL.md` for the corrected causal model and revised remediation order. All other Stage-1 findings (distribution, repair signature, f_03 H1, silent blocker) stand.

**Scope:** derived ONLY from frozen evidence `8b10a766` + freeze blobs at `877bf6dd`. **Zero provider requests** — all conclusions re-derived by deterministically replaying `attemptCompileV4` (pure function, frozen pipeline) over the recorded parsed_candidates. **Integrity self-proof: 72/72 replays match the recorded live errors and statuses**, so every conclusion below is anchored to the frozen evidence.

Tool: `packages/parser-benchmark/src/forensics-v4.ts`; full machine-readable output: `fixtures/parser-bench-v4/forensics/v4-forensics.json`. Nothing in this document writes back to v4; all v4 artifacts remain untouched at `8b10a766`.

## 1. Root-cause distribution (mutually exclusive)

| Root cause | Count | Cases |
|---|---:|---|
| (all stages pass) | 61 | all non-function-zero cases + f_06/07/09/11 |
| REPAIR_REGRESSION | 10 | f_01, f_02, f_04, f_05, f_08, f_10, f_12, f_13, f_14, f_15 |
| EXPECTATION_DISPUTE | 1 | f_03 (adjudicated H1, §4) |
| PARSER_GAP | **0** | — |
| SILENT_FIDELITY (primary) | 0 | (f_05 carries it as secondary, §5) |
| CORE_SEMANTIC / DUALITY / G19_GROUNDING (primary) | 0 | — |

**PARSER_GAP = 0 is a measured result, not an assumption:** all 6 "expected COMPILE_OK but rejected" cases (f_08/10/12–15) had structurally valid A1 raw output — `E_SOURCE_*`/`E_FUNCTION_ZERO_*`/`E_PROVENANCE_GROUNDING` codes only exist after JSON-schema + spec-validate pass. The parser's structural coverage is complete on this dataset; the entire loss chain lives in the fidelity/grounding gate → repair interaction.

## 2. The single causal chain behind all 10 repair regressions

Measured facts (all 10 cases):

1. **A1 was already semantically correct**: `semanticEqual(A1, golden) = true` in all 10; entity `props` are byte-identical to golden (`PROPS EQUAL` for function and equation in both audited exemplars); goals structurally identical.
2. **The only substantive A1/golden difference is the equation's provenance span slice**: golden uses the full sentence (e.g. `"定义 z(m) = m^2 - 9*m + 20，求 z(m) 的零点。"` start=0), the model emits the equation-headed substring (`"z(m) = m^2 - 9*m + 20，求 z(m) 的零点"` start=3, no trailing period). The function spans are identical to golden.
3. That single difference cascades into 3–5 gate errors on A1: `E_PROVENANCE_GROUNDING` (function anchor "absent"), `E_SOURCE_COMPLETENESS` (declaration path = the function span), `E_SOURCE_IRRELEVANT` (function unreachable from goal graph), `E_FUNCTION_ZERO_FUNCTION_MISSING/GOAL_BINDING` — so a correct answer is rejected.
4. Repair fires (unnecessarily) and makes **exactly one systematic edit in 10/10 cases: it appends the function entity into the solve_equation goal's `inputs`** (`["entity:eq_z"] → ["entity:eq_z","entity:func_z"]`; 5 cases additionally nudge a function span start to include the "定义" prefix). This is a misreading of the `E_FUNCTION_ZERO_*` repair hints ("keep the function as a separate entity" → "reference it in the goal").
5. Consequences: 8× `E_BINDING`/compile rejection → PARSE_FAILED (f_01/04/08/10/12/13/14/15); 1× all gates pass but semantics drift → the silent-fidelity case (f_05); 1× ENGINE_UNSUPPORTED verdict but with `E_CAPABILITY_UNSUPPORTED` ≠ declared `expected_error` and core lost (f_02, dual-B miss).

**Bottom line:** the model did not fail these cases; the span-anchor brittleness of the G19/fidelity layer rejected correct answers, and non-monotonic repair then destroyed them. This validates the P5.4 priority: make repair monotonic — but the upstream fix is equally important: the anchor rules reject an equivalent span choice that differs only by the leading "定义" prefix and trailing period.

## 3. Semantic-invalid sufficiency (deterministic replay of the 6 rejections)

All 6: `RAW OUTPUT STRUCTURALLY VALID — rejection came from fidelity/function-zero/grounding gates, not from missing structure`, with uniform A1 error signature `E_SOURCE_COMPLETENESS + E_SOURCE_IRRELEVANT + E_FUNCTION_ZERO_FUNCTION_MISSING + E_PROVENANCE_GROUNDING` (f_01 additionally `E_FUNCTION_ZERO_GOAL_BINDING + E_BINDING`; its A1 goal inputs started with the function). No new model information would have been needed to pass these cases.

## 4. v4_f_03 adjudication (four hypotheses)

Deterministic evidence: compile succeeded, `core=true`, `goal=true`; golden's designed flaw — the equation span is the request sentence `"求 r(y) 的零点。"` with **no equation anchor** (golden grounding: ungrounded>0 by design) — was **not reproduced** by the live output, whose span anchors on the equation text and grounds 100%.

- **H1 engine-has-capability (expectation stale): SUPPORTED.** The capability was never missing; the KNOWN_LIMITATION declaration encodes a *model-behavior assumption* (the model would emit the bad span), not an engine limitation.
- H2 superficial compile: not supported (semantics achieved).
- H3 limitation-detector miss: not supported (G19 fired correctly on the golden design in replay).
- H4 scorer definition mismatch: not supported (COMPILE_OK == PARSER_ACCEPTED per frozen policy; replayed status matches recorded status).

Per protocol, this evidence is the candidate basis for reclassification in a future benchmark version; the v4 declaration itself stays frozen.

## 5. Silent-fidelity blocker (isolated, not averaged)

`v4_f_05` — accepted, zero fidelity findings, but not golden-equal: the repair-passing variant has goal `inputs=["entity:eq_u_zero","entity:u_func"]` vs golden `["entity:eq_4"]`. The extra goal input is exactly the repair regression signature; no current gate detects it (fidelity checks nothing about goal-input closure, binding accepts it because `inputs[0]` is an equation, `semanticEqual` only fails core match). P5.4 must add a detector for goal-input over-referencing (a solve goal referencing a function entity that is already closure-represented by its equation), or make repair structurally incapable of touching conforming fields.

## 6. G19 grounding surface (secondary signal)

A1-stage ungrounded spans appear in 12 cases (g_19, m_11, f_01..f_15 pattern) and are all `function name/equality anchor absent` on the function entity — including cases where the function span is byte-identical to golden's, indicating the anchor verdict is influenced by the equation's span choice (cross-entity anchor coupling) or by normalization beyond the span itself. This needs a direct grounding.ts rule review in P5.4 (it is the upstream trigger of the entire §2 chain).

## 7. P5.4 remediation order (evidence-backed)

1. **Repair monotonicity**: repair may only modify fields implicated by an active error path; a candidate field that is conforming (binding-clean, core-equivalent) must survive repair verbatim. Targeted at `goals.inputs` (10/10 destruction site).
2. **Span-anchor normalization (G19/fidelity)**: accept equivalent equation-span slices (leading declarative prefix, trailing punctuation) — or normalize spans before anchoring. This alone would have prevented 10 unnecessary repairs.
3. **Repair-hint wording**: disambiguate `E_FUNCTION_ZERO_*` hints ("keep the function as a separate entity" must never imply "reference it in goal inputs").
4. **Silent-fidelity detector** for goal-input over-referencing (§5).
5. **f_03-style expectations**: reclassify as model-behavior assumptions (H1) in the next benchmark version, pending owner ruling.
