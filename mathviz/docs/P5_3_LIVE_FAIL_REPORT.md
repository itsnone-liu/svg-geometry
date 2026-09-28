# P5.3 Benchmark v3 — Single Live Acceptance Report (FAIL)

**Verdict: `G20_P5_3_benchmark_v3: FAIL (live)`**

Run date (UTC): 2026-09-28
Provider: `openai-compat:deepseek-v4.1-flash`
Mode: `live` · Cases: 72 · Sampling authorization: **consumed (this run)**
Authority: git-blob-bytes @ freeze commit `4a373e4b5967a9dc9d71d06ea0790350bd0f6a89`

## 1. What was authorized

Three rows must hold together for the single 72-case batch (`docs/P5_3_LIVE_PROTOCOL_BLOB_R2.md`, as amended by A1):

| Row | Result |
|---|---|
| Freeze preflight (blob authority) | **PASS** (6/6) |
| Preregistration present | **PASS** |
| `CREDENTIAL_EXPOSURE_ATTESTED` (Amendment A1) | **PASS** |
| `PROVIDER_AUTH` probe (`GET /models`, zero benchmark content) | **PASS** (`http=200`, `listed=yes`) |
| **`LIVE AUTHORIZED`** | **YES** |

Frozen artifacts were verified byte-identical before the run and are unchanged by this report:
dataset `6a581071…`, scoring policy `2c870cfc…`, manifest `cd28d6f0…`. G17 deterministic parser contract passed 14/14.

## 2. Verdict

Five of the acceptance rows failed. **All five failures are downstream of one primary metric.**

| Metric | Measured | Threshold | Result |
|---|---|---|---|
| `supported_compile_success` | **56/64 = 0.8750** | ≥0.90 | **FAIL** |
| `core_semantic_match` | 56/64 = 0.8750 | ≥0.95 | **FAIL** |
| `goal_capability_accuracy` | 0.8857 | ≥0.95 | **FAIL** |
| `final_schema_semantic_valid` | 0.8889 | ≥0.98 | **FAIL** |
| `challenge_accepted_core_match` | 17/24 | 22/24 | **FAIL** |
| `unsupported_refused_correctly` | 6/6 | 6/6 | PASS |
| `known_limitation_expected_reject` | 2/2 | 1.0 | PASS |
| `g19_final_grounding` | 178/178 = 1.0 | ≥0.985 | PASS |
| `answer_leaks` | 0 | 0 | PASS |
| `silent_fidelity_error_count` | 0 | 0 | PASS |
| `repair_semantic_regressions` | 0 | 0 | PASS |
| `repair_budget_per_case` (max) | 1 | 1 | PASS |

`core_semantic_match` (56/64) and `supported_compile_success` (56/64) share the same numerator: **the same 8 cases**.

## 3. Localization — the failure is domain-specific

| domain | COMPILE_OK expected, compiled | rate |
|---|---|---|
| `motion1d` | 20/20 | **1.000** |
| `geometry2d` | 21/22 | 0.955 |
| `function2d` | **15/22** | **0.682** |
| **total** | **56/64** | **0.875** (needs 0.90) |

`motion1d` and `geometry2d` pass comfortably. **The whole deficit is `function2d`.** In that domain the `compositional` category failed entirely: `f3_cp_01`, `f3_cp_02`, `f3_cp_03`, `f3_cp_04` — 0/4.

## 4. Root cause — one recurring model failure mode

All 10 semantic mismatches fail with the same verifier finding:

```
E_SOURCE_COMPLETENESS  (FIDELITY_ERROR)
'an explicitly declared source entity required by the goal is not represented
 with its own matching entity'
```

Given a statement of the form *"求函数 h(x) = 2x^2 - 18 的所有零点"*, the model **collapses the declared function into an equation** (`capability_id: function2d.solve_equation`, `lhs = 2x^2-18`) instead of materialising the declared function as its own `function` entity. The scoring policy requires the declaration be preserved verbatim; an equivalent solving structure does not satisfy the contract.

The repair trace shows the model oscillating rather than converging:

```
A1:      function2d.solve_equation      (declared function not materialised)
repair:  function2d.expression_curve    (attempts a function entity)
repair:  function2d.solve_equation      (rebinds back to an equation)  → FAIL
```

The second-pass `E_BINDING: input entity 'h' is not an equation` is a direct consequence of this oscillation.

Repair could not recover: `fidelity_repair_success_rate` 4/11 = 0.364; `declared_entity_completeness.first_pass` **0/9**. First-pass fidelity in this domain is systematically wrong, and the single allowed repair is not sufficient to fix it.

## 5. Why this is not a golden defect

A golden defect would require a new benchmark version under the policy's own rule. It is excluded here:

1. **The contract is demonstrably satisfiable** — `motion1d` passes the same declaration-preservation contract 20/20 under an identical verify → repair → rebind pipeline.
2. **The goldens match the statements verbatim** — `h(x) = 2x^2 - 18` is an explicit declaration in the problem text; requiring it be preserved is the intended semantics, not an error.
3. **The failure code is a fidelity error, not a schema/golden-validation error** — the verifier correctly detected a missing declared entity, i.e. it behaved as designed.

This is a genuine, model-attributable capability gap in `function2d` declaration fidelity.

## 6. The failure was honest (fail-closed)

```
answer_leaks: 0
silent_fidelity_errors: 0     ← decisive
repair_semantic_regressions: 0
g19_final_grounding: 178/178
unsupported_refused_correctly: 6/6
```

The model did not fabricate success. In all affected cases it surfaced the fidelity error and was rejected (`PARSE_FAILED`) rather than emitting a contract-violating-but-plausible result that passed silently. `silent_fidelity_errors = 0` is the most important number in this report: **the system failed closed.**

**Interpretation:** the accurate reading is *"function2d declaration fidelity is insufficient, and the verifier faithfully blocked it"* — a valid negative result, not a system malfunction and not reward hacking.

## 7. Protocol compliance during and after the run

- No prompt, few-shot, golden, normaliser or threshold edit occurred during the run.
- No interim stopping and no per-case retries.
- The run started once and was not rerun/resumed/selected after the fact.
- This report is issued **after** the run and does **not** alter goldens or policy in response to results (policy §43).
- The single sampling authorization is **consumed**. A corrective change requires a **new benchmark version and new protocol**, not an edit to v3.

## 8. Evidence artifacts (local, gitignored)

Hashes below identify the immutable run outputs; the files themselves are not committed because `runs/` is ignored by repository hygiene policy.

| Artifact | SHA-256 |
|---|---|
| `runs/p53/benchmark-v3.json` | `01b7207aeb2fdde76779881b2821074c249724902bb0e05db66dbe496388075b` |
| `runs/p53/benchmark-v3-rows.json` | `5182c87d97249d662355b4bc21ae8dcd68ab31ba65b2a5c1c4daec4f44e2a5b3` |
| `runs/p53/benchmark-v3-diagnostics.json` | `01b8508b2ffd4e432fd68ce801ff3c5beeb85018386c744fe4a1ce608e784f38` |

Token usage: 405,168 input / 333,706 output (per case avg 5,627 / 4,635).

## 9. Recommendations (for a future version — not applied here)

These require a **new benchmark version** and fresh preregistration; they are recorded as direction only and must not be retrofitted onto v3.

1. Scope the `function2d` declaration-preservation requirement explicitly in the prompt, since `motion1d` proves the model can satisfy it when the contract is clear.
2. Investigate whether one repair call is the right budget for declaration-fidelity errors, or whether first-pass prompt grounding is the cheaper fix.
3. Preserve `silent_fidelity_error_count = 0` as the primary safety invariant — it held under failure and is the reason this FAIL is trustworthy.