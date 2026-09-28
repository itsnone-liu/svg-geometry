# P5.2 — Grounding-aware bounded repair (frozen contract)

Ruled by the user on 2026-09-28. This document freezes the P5.2 mechanics
BEFORE any live run. The P5.1b live verdict is NOT re-graded: it stands as
FAIL (G19 semantic grounding 165/170 = 97.06% < 98.5%), and the frozen v2
dataset (`fixtures/parser-bench/cases.json`, sha256 `c77c1714…`) and scoring
policy (`docs/P5_1B_SCORING_POLICY.md`, sha256 `a4d91ba0…`) are unchanged and
still verified by the runner before any request.

## 1. Why repair, not verifier expansion

Four of the five P5.1b live failures were model-chosen provenance spans a
human would accept but the bounded lexical/structural verifier does not
(endpoint-naming segment slices, widened shared-clause fact spans, anaphor
slices). Extending scoring v3 after inspecting those outputs would tune the
evaluator to one run's failures. The production answer is the pipeline itself:

    LLM proposes → deterministic gates inspect → bounded repair →
    deterministic system accepts/rejects

G19 enters that chain. The verifier stays bounded and is never silently
upgraded to general NLP entailment.

## 2. Single shared repair budget

The whole pipeline has ONE repair budget per case — not one per gate:

    A0 route → A1 ProblemSpec → schema / semantic / compile / grounding
      ├─ all pass → ACCEPT
      └─ any repairable failure
           └─ budget unspent? ── no ──→ REJECT
                 └─ yes → one repair → ALL gates re-run on the new candidate
                            ├─ pass → ACCEPT
                            └─ fail → REJECT

If the first failure (e.g. E_SCHEMA) spends the repair and the repaired
candidate then hits a grounding failure, the case is rejected — no second
repair. This keeps the existing "repair ≤ 1" contract (`MAX_REPAIRS = 1`)
true. Engine-unsupported refusals (E_CAPABILITY_UNSUPPORTED /
E_MATH_CONSTRAINT) short-circuit BEFORE grounding: a correct refusal is not a
failure to repair. A repaired candidate re-runs every gate, so post-repair
semantics are fully re-grounded — never only the previously failed paths.

## 3. Error contract

Grounding findings become formal structured parser errors:

```json
{
  "code": "E_PROVENANCE_GROUNDING",
  "category": "PROVENANCE_ERROR",
  "path": "/entities/<id>/provenance/span",
  "message": "<deterministic finding reason>",
  "repair_hint": "<contract-level guidance>"
}
```

`repair_hint` is generated deterministically from the finding's path prefix
and reason only. It explains WHAT the contract requires (e.g. "cite the
segment's own label, or both endpoint points together with their
coordinates") — never the correct answer and never a golden span.

The repair prompt keeps receiving the original statement, the previous
complete candidate, ALL deterministic errors, the same capability surface,
and the same entity guide, plus — whenever an E_PROVENANCE_GROUNDING error is
present — the frozen anti-corruption constraints:

- Do not change a mathematical value merely to satisfy grounding.
- Prefer correcting provenance: choose source spans that directly evidence
  each claim.
- If the original text does not support the claim under the contract, do not
  invent supporting evidence.

## 4. Evidence layers and frozen acceptance metrics

The benchmark reports three layers so "how correct was the first model
output" stays separable from "what the deterministic system can reliably
deliver after bounded repair":

- `first_pass_grounding` — grounding of the A1 candidate before any repair;
- `post_repair_grounding` — grounding of the final accepted candidate
  (rejected cases contribute no payload claims: fail-closed rejection removes
  unproven claims from accepted output);
- `final_acceptance` — accepted / engine-unsupported / rejected counts.

Frozen acceptance criteria (live run):

- G18 core metrics unchanged: schema/semantic validity ≥ 98%, core semantic
  match ≥ 95%, goal capability accuracy ≥ 95%, supported compile ≥ 90%,
  unsupported refusals 6/6, answer leakage 0;
- final G19 semantic grounding ≥ 98.5% over accepted payloads;
- repair ≤ 1 per case (structurally enforced);
- `repair_semantic_regressions = 0` — a repair that starts from a
  core-semantically-correct candidate must not end with a semantically
  incorrect final candidate (measured on the produced candidates);
- `grounding_repair_success_rate` — of the cases whose first pass had ≥1
  ungrounded claim and which entered repair, the fraction ending accepted
  with fully grounded final payload. Reported as the direct measure of
  "deterministic verifier + LLM repair" value. Not thresholded.

## 5. Known limitation (recorded, not exempted)

`mo_wd_05` fails closed and stays failing closed: "相向而行" expresses the
relation `direction(A) = opposite(direction(B))`, but the 1D signed-coordinate
model needs per-body signed velocities, and compiling the relation into
`vA > 0, vB < 0` embeds a coordinate-convention step the source text does not
state per body. No exemption, no verifier special-case. The clean long-term
fix is an `opposite_direction(A, B)` relation in a future Motion semantic
contract, compiled to signed velocities by the deterministic compiler; the
Math IR is NOT extended now for one benchmark case.

Recorded as `KNOWN_GROUNDING_MODEL_LIMITATION: relational direction →
per-body signed velocity`.

## 6. Replay calibration (offline evidence, zero tokens)

- The G19 implementation moved to `packages/parser/src/grounding.ts` and is
  re-exported by `packages/parser-benchmark/src/grounding.ts` — one shared
  implementation, no drift possible. Replay `first_pass_grounding` =
  169/171 (98.83%): the frozen v2 calibration number reproduces exactly,
  proving the move is behavior-preserving.
- With the gate wired in, replay shows `mo_wd_05 → PARSE_FAILED (repair)` —
  the documented fail-closed cost — and `post_repair_grounding` 165/165.
  All eight G18 gate checks PASS in replay (validity 59/60, core match
  53/54, refusals 6/6, leaks 0, regressions 0).
- `PROMPT_POLICY_VERSION` bumped to `p5.2-policy-v1`: the repair prompt
  changed (repair_hint rendering + anti-corruption block), so all
  pre-P5.2 validated-spec cache entries are invalidated by key.

## 7. Live protocol

One fresh independent live run against the SAME frozen v2 dataset/policy
(runner verifies both hashes before the first request), using
`npm run gates:g19:live` (guarded `--require-live`). No prompt optimization
phase precedes it; the A1 prompt is untouched. The P5.1b runs remain part of
the record with their original verdicts. If the run passes G18 + G19, the
P5 parser is FROZEN and work proceeds to P6 (Teaching Planner).

## 8. P5.2 live run verdict (2026-09-28, recorded as-run)

One independent live run (deepseek-v4.1-flash, 60 cases, 279,904 input /
191,471 output tokens, repair rate 13.33%). G17 12/12. Verdict:
**G19 PASS, G18 FAIL on exactly one metric (core_semantic_match 51/54 =
94.44% < 95%)**; all other G18 checks pass (validity 59/60, goal capability
100%, supported compile 53/54 = 98.15%, unsupported refusals 6/6, leaks 0,
repair_semantic_regressions 0).

Evidence layers: first_pass_grounding 162/171 (94.74%); post_repair_grounding
165/165 (100%); final_acceptance 53 accepted / 6 engine-unsupported / 1
rejected. **grounding_repair_success_rate 4/5 (80%)** — of five cases entering
grounding repair, four ended fully grounded and accepted (both P5.1b
segment-span failures `geo_wd_01`/`geo_wd_05` among them); the fifth is
`mo_wd_05`, the documented fail-closed limitation (vB + body B re-flagged
after repair, rejected per contract).

The three core mismatches decompose without any P5.2 mechanism failure:

1. `mo_wd_05` — the designed fail-closed cost of this ruling (1.85 pp);
2. `fx_wd_01` — model again omitted the declared `f(x)=x²-9` function entity;
   the emitted spec is schema-valid, compiled, and grounded (1/1), so no gate
   can flag it — the omission is visible only against the golden (recurred
   from the P5.1b run; sample-level model variance);
3. `mo_ir_02` — model extracted an extra source fact (`treeSpacing` 5 m from
   "路边的树每 5 米一棵"): true, explicitly stated, fully grounded (7/7), and
   goal-irrelevant; a precision (over-extraction) miss, not a grounding or
   repair defect. No repair fired because the spec passed every gate.

Nothing frozen was modified after inspecting this run. Per the one-run
protocol above, the P5 parser is NOT frozen on this evidence; the verdict and
its decomposition stand as recorded. Forward options (user decision, none
exercised): (i) accept the recorded verdict and move to P6 with
`mo_wd_05`-class fail-closed cost documented; (ii) authorize one more fresh
independent run (variance-class misses fx_wd_01/mo_ir_02 are not
mechanism-related; a pre-declared single rerun, result committed either way);
(iii) evolve the dataset/scoring to a v3 that, e.g., tolerates goal-irrelevant
grounded facts or excludes the known-limitation case from the core
denominator — each requires a new frozen version and a fresh independent run.
