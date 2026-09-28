# P5.3 Benchmark v3 — Independent Live Protocol R2 (Git-Blob Authority)

Status: **PREREGISTERED (this commit)**. This is a fresh document; it does not
reuse or revive the earlier placeholder draft (retained only as an UNREGISTERED
DRAFT under ignored `runs/p53/`). v3 dataset/scoring semantics are unchanged;
r2 changes only the byte-authority contract and credential gating.

## Status at registration

- P5.3 freeze-r2 = **FROZEN** at Commit A `4a373e4b5967a9dc9d71d06ea0790350bd0f6a89`
  (provider-free preflight PASS on a clean tree at that commit; log retained
  under ignored `runs/p53/preflight-r2-head-4a373e4b5967.log`).
- P5.3 preregistration = **THIS COMMIT** (+ machine-readable pin
  `fixtures/parser-bench-v3/live-pin-r2.json`).
- P5.3 live = **NOT RUN**. Prior starts issued zero provider benchmark
  requests: benchmark cases executed = **0**, A1 calls = **0**, repair calls = **0**.
- P5.3 live authority = **NOT GRANTED** until every launcher gate below is PASS.
  Setting an environment rotation flag is **not** rotation evidence.

前一次启动在 provider request 之前被 freeze preflight 拦截，因此没有产生
stochastic model evidence，不消耗预登记的一次独立模型运行；本协议重新授权
一次且仅一次真正发出 benchmark model requests 的 live acceptance run。

## Frozen surface (authority = committed Git blob bytes at Commit A)

- Benchmark `mathviz-parser-benchmark/v3`, freeze revision `v3.1`, manifest revision `2`.
- Dataset blob SHA-256: `6a581071a92015200658d7226dcadb9d68b28d6d595f704fb99329806e514aa8`.
- Scoring-policy blob SHA-256: `2c870cfc8085ec72e90948f6dda82e9e43ac26d97f47b48791484c94fbf2baa7`.
- Manifest self-check SHA-256: `cd28d6f0e3e256234b4329a0933572a6528c662572d1275b7052285498efb00b`.
- Implementation identities (blob SHA-256): G19 `dd7a1833…`, G20 `24e1acc1…`, pipeline `085b006b…`.
- Prompt policy: `p5.3-policy-v1`; `MAX_REPAIRS = 1`.
- 72 cases: 24/domain; expected outcomes 64 `COMPILE_OK` / 6 `ENGINE_UNSUPPORTED` / 2 `KNOWN_LIMITATION_EXPECTED_REJECT`; challenges 6×4.
- Model: `deepseek-v4.1-flash` at the preconfigured OpenAI-compatible endpoint (`token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`); report model id + endpoint only, never the key.
- Verifier, preflight and runner all read/parse the SAME frozen blobs
  (`git cat-file blob <freeze-commit>:<path>`); worktree CRLF/LF is audit-only.

## Acceptance thresholds — unchanged (conjunctive)

Final expected-outcome validity ≥98% of 72; core semantic match ≥95% over the 64
`COMPILE_OK`; goal-capability accuracy ≥95%; supported compile success ≥90%;
G19 final grounding ≥98.5%; 6/6 unsupported and 2/2 known-limitation classified
correctly; exactly 0 answer leaks, 0 repair regressions, 0 silent fidelity
errors, 0 unsupported semantic corruption; ≤1 repair per case; each challenge
class 6/6 detected-or-correct (multi-finding = no second repair); ≥22/24
challenge-case accepted core matches.

## Credential protocol (human-owned; no env-flag shortcuts)

Amendment A1 defines two operational policies: `STRICT` and
`DISPOSABLE_ACCEPTED`. Select exactly one in the gitignored
`runs/p53/CREDENTIAL_POLICY_ACK.md`, with `credential_risk_acknowledged: true`,
`scope: P5.3_INDEPENDENT_LIVE_ONLY`, `accepted-loss-bound: ...`, and
`confirmed-at-utc: ...`. `DISPOSABLE_ACCEPTED` permits a disposable/low-balance
credential after explicit risk acceptance and does not require rotation proof;
`STRICT` additionally requires the human rotation attestation. Credential policy
never changes benchmark validity, scoring, thresholds, or the one-run rule.

The key is never sent through chat, committed, or printed. Only after the
selected policy, acknowledgement/rotation requirement, and credential presence
pass may `npm run p53:provider-auth-check` run: a single `GET /models` probe
(HTTP 2xx required) sending **zero** benchmark content. If the v3 live result
report already exists, the one v3 authorization is consumed and policy changes
cannot reopen it; a corrective run requires a new benchmark version and fresh
preregistration.

## Launcher gate table (`npm run gates:p53:live`)

```
FREEZE_COMMIT_PINNED       PASS
DATASET_BLOB_HASH          PASS
SCORING_POLICY_BLOB_HASH   PASS
MANIFEST_SELF_CHECK        PASS
WORKTREE_DIRTY             PASS      (PASS = clean)
PREREGISTRATION_PRESENT    PASS
CREDENTIAL_POLICY          DISPOSABLE_ACCEPTED or STRICT
CREDENTIAL_RISK_ACK        PASS
CREDENTIAL_PRESENT         PASS
PROVIDER_AUTH              PASS      (models endpoint, zero benchmark content)
SINGLE_RUN_AUTHORITY       PASS      (unconsumed new protocol only)
LIVE AUTHORIZED            YES
```

Any row not PASS stops the launcher **before G17, A0/A1, and every benchmark
case**. Preflight and G17 are deterministic and consume no sampling
authorization.

## Single-run rules

Exactly one uninterrupted 72-case batch from the frozen blobs at Commit A, in
dataset order, no interruption/retry/selection/rerun once the first benchmark
request is sent. Deterministic preflight/G17 failures before the first case do
not consume the authorization and must be recorded, not retried around. If the
batch never starts, commit `LIVE BLOCKED` with cases=0/A1=0/repair=0.

## Result retention

After the one actual batch: commit the complete summary, per-case rows,
diagnostics, model id, timestamps, invocation commit (this commit) and PASS/FAIL
verdict. Replay/gate output is never live evidence. R2 authorizes no second
live batch. Any change to the frozen artifacts after this registration requires
a new benchmark version and a new preregistration.
