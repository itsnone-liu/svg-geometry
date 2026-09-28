# P5.2 Independent Replication Protocol (preregistered)

Authorized by the user on 2026-09-28, verbatim ruling:

> 本次为 P5.2 冻结实现的一次预声明独立复验。无论 PASS/FAIL，完整结果均
> 提交；本次之后不再通过重复抽样选择性寻求 PASS。

This document is committed BEFORE the replication run starts. It is Run 2 and
the final sampling event for the P5.2 frozen implementation.

## 1. Frozen surfaces (identical to Run 1)

| Surface | Identity |
|---|---|
| Dataset v2 | `fixtures/parser-bench/cases.json` — 60 cases, sha256 `c77c1714aebda407d0d05e9dc7c966cfe74418f8c254aa300fe60cdc3c1e66cc` |
| Scoring policy v2 | `docs/P5_1B_SCORING_POLICY.md` sha256 `a4d91ba0d7727e01dec4d236b3127a267eac4107f60120b01f342f419cf3214a` |
| G19 verifier | `packages/parser/src/grounding.ts` at commit `0234ea2` |
| P5.2 pipeline & prompt policy | commit `0234ea2`, `PROMPT_POLICY_VERSION = p5.2-policy-v1` |
| Model | deepseek-v4.1-flash (Aliyun Bailian, Token Plan) |
| Benchmark | same 60-case v2 set, `noCache: true`, `--require-live` guard |
| Code | HEAD of this commit (docs-only delta over `0234ea2`; zero code/prompt/few-shot/golden/normalizer/threshold changes) |

## 2. Prohibitions during the run (user's list)

- No prompt or few-shot changes
- No golden changes
- No normalizer changes
- No threshold changes
- No stopping based on interim results
- No per-case retries on individual failures
- Transport-level bounded retry (E_PROVIDER/E_HTTP 429/5xx) remains active as
  shipped infrastructure, as in Run 1 — it is not a resample of model output

## 3. Acceptance criteria (unchanged, frozen)

G18: final schema/semantic validity ≥ 98%; core semantic match ≥ 95%; goal
capability accuracy ≥ 95%; supported compile success ≥ 90%; unsupported
refusals 6/6; answer leakage 0.
G19: final semantic grounding ≥ 98.5% over accepted payloads.
Structural: `repair_semantic_regressions = 0`; repair ≤ 1 per case.

## 4. Decision rule (written before the run)

- **If G18 + G19 both PASS → P5 Parser FINAL FROZEN → proceed to P6
  (Teaching Planner).**
- **If either FAILS → no third or further sampling runs.** The miss is then
  not attributable to run variance alone; a new stage P5.3 Parser
  Precision/Completeness opens, targeting the real parser gaps observed —
  `fx_wd_01`: explicitly-declared source-entity completeness; `mo_ir_02`:
  goal-irrelevant source-semantic precision — to be accepted via a NEW
  prompt-policy version and a NEW independent benchmark, never by editing
  the old scoring.
- Diagnostic note carried from Run 1 (pre-registered observation): `fx_wd_01`
  omitted the declared function entity in BOTH prior live runs, so it is not
  obviously random noise like `mo_ir_02`; Run 2's purpose is precisely to
  distinguish "frozen P5.2 parser already crosses the bar" from "a
  repeatable entity-completeness gap exists".

## 5. Run log

| Run | Date (UTC) | Commit | Verdict |
|---|---|---|---|
| 1 | 2026-09-28 | `0234ea2` | G19 PASS (165/165); G18 FAIL core_semantic_match 51/54 = 94.44% (misses: mo_wd_05 designed fail-closed; fx_wd_01 entity omission; mo_ir_02 grounded-irrelevant extra fact). Recorded in `docs/P5_2_GROUNDING_REPAIR.md` §8 |
| 2 | 2026-09-28 (this run) | this commit | — |
