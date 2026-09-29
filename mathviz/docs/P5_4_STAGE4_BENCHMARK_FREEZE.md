# P5.4 Stage-4 — Benchmark v5 Construction & Freeze

**Authority:** owner authorization 2026-09-29 (offline benchmark construction, static validation, scorer/gate validation, freeze; provider/live FORBIDDEN; new live authorization NOT YET GRANTED). Built on the Stage-3 FINAL baseline `02a9298`. Zero provider requests from first case definition to freeze.

## Dataset structure (pre-frozen, never adjusted by live)

```
72 cases = geometry2d 24 (22 COMPILE_OK + 2 ENGINE_UNSUPPORTED)
         + motion1d    24 (22 COMPILE_OK + 2 ENGINE_UNSUPPORTED)
         + function2d  24 (22 COMPILE_OK + 2 ENGINE_UNSUPPORTED)
TOTAL: 66 COMPILE_OK · 6 ENGINE_UNSUPPORTED · 0 KNOWN_LIMITATION
```

KNOWN_LIMITATION = 0 is permanent: the system boundary is now "compile whatever is expressible; ENGINE_UNSUPPORTED only when the engine truly refuses". The two v4 KNOWN cases were **reclassified, not deleted**: v4_f_03/f_04 become v5_f_03/v5_f_04 COMPILE_OK duals with the equation span corrected to the full-sentence slice (the grounding pattern of every healthy dual golden). The v4 declaration stays frozen history (`877bf6d`, verdict FAIL @ `8b10a766`).

## Composition of function2d (24)

| Segment | Cases | Notes |
|---|---|---|
| Dual B (EU) | v5_f_01, v5_f_02 | irrational roots — engine truly refuses; dual contract + EU terminal state |
| Dual A (reclassified) | v5_f_03, v5_f_04 | KNOWN→CO per the f_03 H1 adjudication; span corrected |
| Dual A (migrated) | v5_f_05 … v5_f_15 | the v4 repair-regression family — statements/goldens unchanged, so the Stage-2/3 mechanisms face the exact shapes that broke v4 |
| Bare (migrated) | v5_f_16 … v5_f_22 | plain solve-equation controls |
| Bare (new shape) | v5_f_23 | **two solve_equation goals** in one statement (goal-local binding; only-one-broken sensitivity) — probe-verified golden |
| Bare (new shape) | v5_f_24 | **AST-equivalent but surface-different** equation `25m − 4(m+7) = 0` (golden keeps the statement's own tree; canonical normalization handles equivalence) |

## Pre-frozen expectations (principle 1)

Every case carries an `expectations` block frozen before any provider request: expected class/stage/error, expected capabilities, required entities (with canonical labels), **grounding span authority** (exact `{start,end,text}` per entity), **protected goal expectations** (goalId + inputs for every solve goal — what repair must preserve byte-identically), dual family, and repair-sensitive tags. Live scoring reads these; it can never rewrite them.

## Challenge registry (principles 2+3) — `challenge-registry.json`

**Dual registry:** 15 pre-registered IDs (13 A_DUAL_COMPILE_OK + 2 B_DUAL_ENGINE_UNSUPPORTED), each with its expected behavior sentence. Cross-checked against the computed dual set (function2d goldens containing function entities): exact match.

**Repair-sensitive coverage (9/9 owner classes):** missing-declaration-label (all 13 dual A — the v4-proven systematic omission), wrong-entity-label (v5_f_03), goal-local-binding (v5_f_16/17/23), multiple-solve-goals-partial-break (v5_f_23), equation-function-variable-mismatch (v5_f_06), non-x-variable (v5_f_02/06/07), ast-equivalent-surface-different (v5_f_24), provenance-span-locally-wrong (v5_f_03/04), over-reference-irrelevant-source (v5_f_05/08).

## Gates & validation

- **Golden replay scorer** (`run-v5-golden.ts`): 12/12 checks PASS — total 72, class matrix 66/6/0, domains 24/24/24, CO accepted+core 66/66, EU refused 6/6, dual detected 15/15, split 13/2, A accepted+core 13/13, B EU-correct 2/2, bare over-constraint 0, span authority exact, answer leaks 0.
- **Pre-freeze preflight B1–B12** (`preflight-v5.ts`): **PASS 12/12** — including B8 scorer determinism (two runs byte-identical), B9 v3 frozen replay PASS, B10 v4 golden scorer PASS, B11 Stage-3 H1–H5 8/8, B12 packet-no-leaks (statement-only input; no golden/expectation content in any provider-visible packet).
- Full vitest 262/262 (no v3/v4 test touched).

## Freeze manifest — `freeze-v5.json`

Pins SHA-256 over 10 files (dataset, registry, scorer, preflight, builder, five v5 pipeline modules) + the **canonical provider-visible packet hash** (all 72 spec-call requests, dataset order, stable serialization). Authority = committed Git blob bytes (P5.3 model). Denominators embedded and drift-guarded. Live policy recorded: provider FORBIDDEN until a new independent authorization; max repairs = 1; deterministic projection is not a second repair but must pass the protected-closure audit; the v4 verdict stays FAIL and is never rewritten.

## Chain

```
Stage-3 FINAL baseline  02a9298
Stage-4 build commit    (this commit — tools + dataset + registry + docs)
Stage-4 FREEZE commit   (freeze-v5.json manifest — THE v5 freeze authority)
v4 history              877bf6d freeze · 8b10a766 FAIL evidence (immutable)
```

After the freeze commit, the remaining chain per the owner: final preflight → new independent live authorization discussion. Until then: provider FORBIDDEN, live FORBIDDEN.
