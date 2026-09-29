# P5.4 Stage-3.1 Hardening — Complete

**Authority:** owner authorization 2026-09-29, after remote audit of `0a571e9` found four structural bypasses in the Stage-3 gates. All fixes offline; zero provider requests; zero touches on v3/v4 frozen files or historical evidence.

## The four closures

**1. Repair call accounting (H4).** The projection path no longer emits a second `stage:"repair"` diagnostic — the projected candidate's gate outcome now lives in `repairAudit.projected_gates`. Invariant restored: **1 provider repair request = 1 repair diagnostic**; a scorer counting repair diagnostics cannot double-count the audit.

**2. Path-scoped suppression (H1).** `identity-v5` now returns an explicit suppression *spec* instead of a code list, and `parse-v5` suppresses only:
- `E_SOURCE_COMPLETENESS` at the declaration's own path (`/statement/declaration/<start>-<end>`);
- `E_SOURCE_IRRELEVANT` at `/entities/<missing-label-entity>`;
- `E_PROVENANCE_GROUNDING` at `/entities/<missing-label-entity>/provenance/span`.

Same-code errors on other entities/declarations always survive, and the suppressed detail is recorded per `{code,path}` (`suppressedFindings.items`), not just as a count.

**3. Protected goal closure (H2/H3).** `repair-v5` now protects, for every A1-conforming solve goal not implicated by an active error: **goal existence** (deletion is projected back wholesale), **goalId/capabilityId/inputs** (byte-identical survival), and the **existence + equation kind of the entity referenced by inputs[0]**. Implication is **path-located per goal** (`/goals/<goalId>` prefix); a `GOAL_BINDING` error on one goal no longer unlocks another. Only an unattributable goal-binding error (no goal-locating path) falls back to unlocking all goals — conservative, never silent.

**4. Stage-2D consistency (H5).** `grounding-v5`'s corrected special case now pins `equation.props.variable === function.props.variable`, and — important correction found during hardening — the wrapper's interception target was realigned: the frozen special case (dead code in v4: reversed `functionDeclaration` args + `"^2"`/`"x^2"` substring evidence) overrules the **equation entity's semantic verdict**, not the function-anchor absence. The v5 wrapper now re-adjudicates exactly that verdict under corrected evidence: declared-name anchor over the function's own exact span (`name(` + `=`), canonical-AST equivalence (lhs ≡ expr, rhs ≡ 0), **declared-variable equality**, AST power-form evidence (any `^` node — `h(y)=y²−4` works, not just x-quadratics), and a zero-request term in the equation's valid exact slice. A wrong-variable equation is never released.

## H1–H5 test results (`tests/p54-stage31.test.ts`)

| Gate | Result |
|---|---|
| H1 independent irrelevant entity survives suppression (detail per `{code,path}`) | PASS |
| H2 two solve goals, one binding error → the other stays protected | PASS |
| H3 goal deletion / referenced-equation deletion / capabilityId rewrite → all projected | PASS |
| H4 projection keeps provider repair calls == 1 (mock-provider end-to-end) | PASS |
| H5 non-x power-form: matching variable released, wrong-variable never released | PASS |

## Full regression suite

- `tsc` 0 errors
- **vitest 262/262** (241 pre-existing + 13 Stage-2 + 8 Stage-3.1)
- **G-P54-1 PASS 10/10 · G-P54-2 PASS 10/10 · G-P54-3 PASS** (silent accepted = 0; f_05 over-ref detected)
- **v3 frozen evidence replay PASS · v4 golden scorer replay PASS**
- 72-case frozen evidence replay: unchanged profile — 70 identical; the 2 changes remain exactly the over-reference detector firing on the recorded destructive repairs (f_02, f_05). Counterfactual remediation evidence only; the v4 live verdict stays FAIL @ 8b10a766.

## Status

```
P5.4 Stage-2 implementation     PASS @ 0a571e9
P5.4 Stage-3 gates              PASS
P5.4 Stage-3.1 hardening        COMPLETE (this commit)
P5.4 Stage-3 FINAL              ready for owner sign-off
Stage-4 benchmark construction  NOT YET AUTHORIZED (design principle noted:
                                72 = 3×(22 COMPILE_OK + 2 ENGINE_UNSUPPORTED),
                                KNOWN_LIMITATION = 0 — f_03-class expectations
                                move to the new declaration, v4 stays history)
provider / live                 FORBIDDEN
```
