# P5.3 Benchmark v3 — Live Protocol R2 **Amendment A1** (Credential Gate: Exposure Attestation)

Status: **PREREGISTERED (this commit)**. This amendment revises one and only one
clause of `docs/P5_3_LIVE_PROTOCOL_BLOB_R2.md`: the credential prerequisite.
It is issued under the authority of that document's own change rule
(*"Any change to the frozen artifacts after this registration requires a new
benchmark version and a new preregistration"*) and the R2 single-run rule
(*"Any change to the frozen artifacts"*) — both of which are satisfied here
because **no frozen artifact is modified**. Only the credential gate is
re-defined; dataset, scoring policy, manifest, implementation identities,
prompt policy and acceptance thresholds are byte-identical to R2.

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

## Amended clause — Credential protocol (replaces R2 §"Credential protocol")

1. The owner attests, in the gitignored file
   `runs/p53/CREDENTIAL_EXPOSURE_ATTESTATION.md`, that the credential the runner
   will use has **not** been exposed on any untrusted surface (committed blob,
   tracked file, chat transcript, log, or shared document), **or** that any
   exposure is bounded to an accepted allowance. The file must contain at least:
   - `credential-not-exposed` (or `exposure-bounded-accepted`), and
   - `confirmed-at-utc: <ISO-8601 UTC timestamp>`, and
   - `accepted-loss-bound: <amount or "n/a">`.
2. No env flag is evidence. The file is the only evidence, as before.
3. Only then may `npm run p53:provider-auth-check` run: a single `GET /models`
   probe (HTTP 2xx required) sending **zero** benchmark content.
4. The credential value is never sent through chat, committed, or printed.

## Amended gate table (`npm run gates:p53:live`)

```
FREEZE_COMMIT_PINNED         PASS
DATASET_BLOB_HASH            PASS
SCORING_POLICY_BLOB_HASH     PASS
MANIFEST_SELF_CHECK          PASS
WORKTREE_DIRTY               PASS      (PASS = clean)
PREREGISTRATION_PRESENT      PASS
CREDENTIAL_EXPOSURE_ATTESTED PASS      (human attestation file only)
PROVIDER_AUTH                PASS      (models endpoint, zero benchmark content)
LIVE AUTHORIZED              YES
```

The row formerly named `KEY_ROTATION_CONFIRMED` is replaced by
`CREDENTIAL_EXPOSURE_ATTESTED`. All other rows, their semantics, and the
"any row not PASS stops the launcher before G17/A0/A1 and every benchmark case"
rule are unchanged.

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

The three blocked attempts recorded in `runs/p53/LIVE_BLOCKED.md` produced zero
benchmark cases, zero A1 calls and zero repair calls. None consumed the single
independent sampling authorization. Under R2 §"Single-run rules", failures that
occur before the first benchmark request are recorded and not retried around;
they remain recorded as-is. This amendment does **not** retroactively alter
them, and does not authorize more than the **one** remaining live batch that R2
already reserved.

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
must report `CREDENTIAL_EXPOSURE_ATTESTED` (not rotation) in its gate summary.