# P5.3 Benchmark v3 — Live Protocol R2 **Amendment A1** (Credential Policy)

Status: **PREREGISTERED (this commit)**. This amendment revises one and only one
operational clause of `docs/P5_3_LIVE_PROTOCOL_BLOB_R2.md`: credential
authorization. It does not modify any frozen artifact, benchmark case, scoring
rule, threshold, prompt policy, implementation identity, or single-run result.
The accepted policies are `STRICT` and `DISPOSABLE_ACCEPTED`; credential policy
never determines benchmark validity or score.

## Why this amendment exists

R2 required a **provider-side key rotation** before any provider call, expressed
as the gate row `KEY_ROTATION_CONFIRMED` (`human attestation file only`), citing
that the P5.2 key had been "exposed in chat" (see `runs/p53/LIVE_BLOCKED.md`,
Attempt 1).

That requirement was **wrongly scoped to a proxy for the actual risk.** The risk
R2 intended to avoid is *using a credential that has leaked into an
untrusted, persistent, or publicly-readable surface*. Rotation is **one**
remediation for that risk; it is not the risk itself. Re-deriving the gate on
the risk directly yields a requirement that is both stricter in what it
demands (positive evidence about exposure, not merely the act of rotating) and
realistic to satisfy.

Three facts, established by the repository owner on 2026-09-28, resolve the R2
precondition:

1. **No leak occurred.** The key value has never been present in any committed
   blob, any tracked file, or any chat transcript. The P5.2 chat artifact that
   R2 reacted to did not carry the secret; `LIVE_BLOCKED.md` itself records
   "No key value was printed, copied into source, or committed."
2. **Blast radius is bounded and accepted.** The credential sits on a prepaid
   Token-Plan allowance on the order of ¥100. Even under the pessimistic
   assumption of full exposure, the worst-case loss is that allowance. This is
   the owner's risk decision and is recorded as such, not as a claim of
   impossibility.
3. **Rotation is operationally disproportionate.** The same credential is
   provisioned across multiple agents and several office machines. Provider-side
   rotation is a coordinated multi-host change, and the owner has declined it as
   the remediation for this run.

Given (1)–(3), the *correct* gate is not "did you rotate?" but **"is the
credential that the runner will use attested as not-exposed?"** — which is what
this amendment defines.

**Honesty constraint (binding).** This amendment does **not** assert that a
rotation occurred. It must never be represented as rotation evidence, and the
attestation file it defines must never contain the phrase
`provider-side rotation completed`. The record is an *exposure* attestation, and
it says so in its own text.

## Amended clause — Credential policy (replaces R2 credential prerequisite)

Exactly one operational policy must be selected in the gitignored file
`runs/p53/CREDENTIAL_POLICY_ACK.md`:

```text
credential_policy: STRICT
credential_risk_acknowledged: true
scope: P5.3_INDEPENDENT_LIVE_ONLY
accepted-loss-bound: n/a
confirmed-at-utc: <ISO-8601 UTC timestamp>
```

or:

```text
credential_policy: DISPOSABLE_ACCEPTED
credential_risk_acknowledged: true
scope: P5.3_INDEPENDENT_LIVE_ONLY
accepted-loss-bound: <amount or n/a>
confirmed-at-utc: <ISO-8601 UTC timestamp>
```

`STRICT` requires the separate human-created `ROTATION_ATTESTATION.md` proof.
`DISPOSABLE_ACCEPTED` is for a disposable/low-balance test credential and
requires explicit user risk acknowledgement, credential presence, and the
provider auth probe; it **does not require rotation proof**. In both modes:

- no environment flag is evidence;
- the key value is never sent through chat, committed, or printed;
- the policy authorizes provider access only and cannot alter benchmark validity;
- `GET /models` runs only after policy, acknowledgement/rotation, and
  credential-presence gates pass, and sends zero benchmark content.

The already committed `CREDENTIAL_EXPOSURE_ATTESTATION.md` remains valid
supporting evidence for the bounded-risk decision, but the selected policy
file is the machine-checked contract. If `docs/P5_3_LIVE_FAIL_REPORT.md`
exists, the v3 one-run authorization is already consumed and no credential
policy can reopen it; a corrective run requires a new benchmark version and
new preregistration.

## Amended gate table (`npm run gates:p53:live`)

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
PROVIDER_AUTH              PASS (models endpoint, zero benchmark content)
SINGLE_RUN_AUTHORITY       PASS (only for an unconsumed new protocol)
LIVE AUTHORIZED            YES
```

For `STRICT`, `KEY_ROTATION_CONFIRMED` is additionally required. For
`DISPOSABLE_ACCEPTED`, rotation is not a gate; explicit risk acceptance is.
Any non-PASS row stops before G17/A0/A1 and every benchmark case.

## What is explicitly NOT changed

- Frozen dataset blob `6a581071a92015200658d7226dcadb9d68b28d6d595f704fb99329806e514aa8`
- Frozen scoring-policy blob `2c870cfc8085ec72e90948f6dda82e9e43ac26d97f47b48791484c94fbf2baa7`
- Manifest self-check `cd28d6f0e3e256234b4329a0933572a6528c662572d1275b7052285498efb00b`
- Implementation identities (G19/G20/pipeline), prompt policy `p5.3-policy-v1`, `MAX_REPAIRS = 1`
- 72 cases / 24 per domain / expected-outcome distribution / all challenge counts
- Every acceptance threshold in R2 §"Acceptance thresholds" (still conjunctive)
- The single-run rule: exactly one uninterrupted 72-case batch, no rerun, no
  resume, no selection, no post-start freeze patching
- The rule that deterministic preflight/G17 failures before the first case do
  not consume the sampling authorization

## Prior evidence disposition

The four attempts recorded in `runs/p53/LIVE_BLOCKED.md` include three
pre-request starts with zero benchmark cases/A1/repair calls and Attempt 4,
which completed the one live 72-case batch and consumed its sampling
authorization. This amendment does **not** reopen, rerun, or selectively
resample that v3 batch. A corrective run requires a new benchmark version and
new preregistration.

## Authority and provenance

- This amendment is authored as a protocol revision, committed to Git, and
  becomes the operative credential clause on commit.
- Where this amendment and R2 conflict on the credential prerequisite, **this
  amendment governs**. Everywhere else, R2 governs.
- The amendment is itself subject to the same no-post-start-change rule: once
  the single live batch begins, neither this file nor any frozen artifact may be
  edited until the batch's verdict is recorded.

## Result retention

Unchanged from R2, plus: the committed result record must cite **this
amendment's commit** as the invocation authority instead of the R2 commit, and
must report the selected `CREDENTIAL_POLICY`, `CREDENTIAL_RISK_ACK`, `CREDENTIAL_PRESENT`, and `SINGLE_RUN_AUTHORITY` gate results. Legacy exposure-attestation records remain audit evidence only; they are not benchmark validity evidence.