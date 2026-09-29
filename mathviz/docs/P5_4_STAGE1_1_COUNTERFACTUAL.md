# P5.4 Stage-1.1 Counterfactual Causality Audit — ERRATUM to Stage-1 §2

**Authority:** owner-authorized after remote re-audit of frozen evidence found a fact Stage-1 omitted: **10/10 regression-case A1 function entities lack `label`** (golden carries `label:"p"/"q"/"s"/"u"/"z"/"v"/"w"`; verified on all 10). Stage-1's diff compared `props` and `provenance.span` but never the `label` identity field, and attributed the gate cascade to the equation-span slice difference. This audit adjudicates causality mechanically.

**Method:** zero provider requests. For each of the 10 repair-regression cases, `attemptCompileV4` was replayed over four variants of the recorded A1 candidate: CF0 = verbatim control; **CF1 = ONLY golden `function.label` added** (every other byte identical); **CF2 = ONLY equation `provenance.span` replaced by golden's span**; CF3 = both. Tool: `packages/parser-benchmark/src/forensics-v4-cf.ts`; full output: `fixtures/parser-bench-v4/forensics/v4-forensics-cf.json`.

## Result (machine-adjudicated, decision rule pre-registered by owner)

| Variant | Cleared all errors | Effect |
|---|---:|---|
| CF0 control | 0/10 | 4–5 errors each (the recorded cascade) |
| **CF1 (add label only)** | **8/10 fully clean; 10/10 cleared of ALL four G19/G20/G20-D fidelity errors** | the remaining single `E_CAPABILITY_UNSUPPORTED` on f_01/f_02 is exactly their declared `expected_error`; with parser-owned errors gone it yields the **correct ENGINE_UNSUPPORTED verdict** (dual-B compliant) |
| CF2 (span only) | **0/10** | error set unchanged (8/10) or worsened (f_04: golden's span adds a grounding error) |
| CF3 (both) | 7/10 + f_01/02 as CF1 | strictly no better than CF1; the golden span actively harms f_04 |

The mechanical verdict string ("neither CF1 nor CF2 nor CF3 fully sufficient… third factor: v4_f_01, v4_f_02") fired only because CF1 leaves f_01/f_02 with their *declared expected* compile error — which is the correct dual-B outcome, not a residual defect. No third factor is indicated.

## Corrected causal model (supersedes Stage-1 §2 chain)

```
A1 math structure correct (props byte-identical, core-equivalent)
  ↓ named-function identity field missing (function.label absent)
G19/G20/G20-D correctly judge declaration identity unclosed
  (verifier resolves declared name via e.label ?? e.id → "u_func" ≠ "u")
  → E_SOURCE_COMPLETENESS + E_SOURCE_IRRELEVANT
  → E_FUNCTION_ZERO_FUNCTION_MISSING + E_PROVENANCE_GROUNDING
  ↓ repair legitimately triggered
repair SHOULD have added only function.label
  ↓ instead it appended the function entity into goal.inputs (10/10)
  → 8 binding/compile rejections, 1 silent drift (f_05), 1 dual-B miss (f_02)
```

**Erratum to Stage-1 §2:** the equation-span slice difference was a **confounding correlate, not a cause** (CF2: 0/10). The gates behaved correctly on identity-incomplete output; the failure was upstream in the model's omission of the canonical `label` and downstream in non-monotonic repair. Stage-1 findings that STAND unchanged: root-cause distribution (61 pass / 10 REPAIR_REGRESSION / 1 EXPECTATION_DISPUTE / PARSER_GAP=0), the repair `goals.inputs` destruction signature, the f_03 H1 adjudication, the silent-fidelity blocker isolation, and repair-monotonicity as mandatory remediation.

## Revised P5.4 remediation order

1. **Named-function identity contract** (promoted to primary): explicit `f(x)=…` function entities must carry canonical `label=f`; internal ids are not declaration-name substitutes; prompts/hints must instruct "add the label", never "reference the function in the goal".
2. **Repair monotonicity** (unchanged, mandatory): conforming `goal.inputs` must survive repair verbatim; deterministic projection/rejection over model replacements.
3. **Goal-input over-reference detector** (unchanged): `function2d.solve_equation` accepts an equation input; extra function references must be a deterministic G20-D/verifier failure (kills the f_05 silent class).
4. **G19 function-zero special-case bugfix** (owner-found in frozen grounding.ts): parameter order reversed in `functionDeclaration(f.label ?? nameOf(f), f.provenance.span.text)` plus a hardcoded `"x^2"`; fix with canonical AST/variable handling. Not yet implicated as a live-regression cause (CF1 sufficed without it).
5. **Span-anchor normalization: DOWNGRADED** — CF2 shows the equation-span variant neither causes the cascade nor blocks correctness; do NOT relax G19 exact-slice strictness for this. Exact source slices remain mandatory; only proven-equivalent boundaries may ever be tolerated.
6. **f_03 expectation** reclassification in the next benchmark version (H1 evidence stands; v4 declaration frozen).
