# P5.3 Live Acceptance — LIVE BLOCKED

## Attempt 1: credential freshness was not attested

- Date: 2026-09-28
- Preregistration commit: `00a75d3bab7de1f9152da7fddf7fe5adfc103276`
- Frozen dataset SHA-256: `6a581071a92015200658d7226dcadb9d68b28d6d595f704fb99329806e514aa8`
- Frozen scoring-policy SHA-256: `e6ae32256f8b296d8cb09beebddbf942ce35c1234b37777a698a2817e9dcaeef`
- Gate invocation: `npm run gates:p53:live`
- Gate result: runner exited before G17 or any provider call because the configured key's freshness/rotation was unattested.

The local ignored `.env` contains provider configuration, but available evidence did not establish that its key differs from the P5.2 key exposed in chat. No key value was printed, copied into source, or committed. The one-run protocol explicitly prohibited reuse of that exposed key; therefore no provider request was made.

## Attempt 2: stale scoring-policy freeze stopped the run before model calls

The user subsequently stated that the key had been rotated. A single guarded runner invocation was started with the non-secret rotation attestation set for that process. G17 passed, but the v3 runner's preflight rejected a SHA-256 mismatch between the committed scoring-policy freeze (`e6ae3225…`) and the policy file bytes as read at runtime (`2c870cfc…`). This occurred before any P5.3 A1/repair call; the model was not invoked and no benchmark cases ran. The discrepancy is consistent with line-ending normalization between the committed and runtime policy bytes; regardless, the freeze verifier correctly stopped the run. Per the preregistered no-post-start freeze rule, do not patch the hash and retry this version or resume the 72-case batch.

## Attempt 3: local TSX launcher fix reached the LF guard; no model sampling

- Date: 2026-09-28
- Gate invocation: `node scripts/run-live-v3.mjs` with the local TSX CLI launcher selected; the process had an ephemeral non-secret rotation-flag override solely to test the launcher/preflight path.
- Gate result: the newly added provider-free freeze preflight rejected CRLF in the working-tree scoring-policy file before G17 or the benchmark runner.
- Model requests: zero benchmark cases, zero A1 requests, zero repair requests. The flag override is not secure evidence that the configured secret key was rotated; the live request guard was never reached.

The runner path now invokes `node_modules/tsx/dist/cli.mjs` through `process.execPath`, avoiding the former shell PATH failure. The same pass exposed Git's behavior: with `core.autocrlf=true`, `git checkout-index -f` still wrote CRLF in spite of the scoped `eol=lf` attribute. Explicitly writing LF bytes and staging them fixed the worktree; later policy edits must not rely on checkout commands for LF enforcement.

## Superseded interim r2 note (2026-09-28)

An interim offline precommit PASS was recorded against the earlier worktree-byte authority with hashes `c1c97142…` (policy) and `79681bfb…`/`37d14417…` (manifest). That evidence is **SUPERSEDED and invalid as freeze evidence**: the scoring-policy bytes were subsequently restored to the original semantic content, and the authority model itself changed (see below). Retained only as audit history of the false start.

## Formal status at the implementation pause (2026-09-28, ordered by the owner)

- P5.3 freeze-r2      = **NOT FROZEN**
- P5.3 preregistration = **NONE**
- P5.3 live            = **NOT RUN**
- P5.3 live authority  = **NOT GRANTED**
- benchmark cases executed = **0**
- A1 calls                = **0**
- repair calls            = **0**

**Credential correction (binding):** setting the non-secret rotation flag in a test process is **NOT** proof that the API key was rotated. Attempt 3 is recorded only as a launcher/preflight test. No credential evidence exists in-repo, and an environment flag must never be treated as rotation evidence again. Live authorization requires human confirmation that provider-side rotation actually completed.

## EOL/authority diagnostics (read-only, no files modified)

- `git check-attr --all -- docs/P5_3_SCORING_POLICY.md` → `text: set`, `eol: lf` (attributes resolve correctly).
- `git ls-files --eol` → dataset/policy/manifest all `i/lf w/lf attr/text eol=lf` at inspection time.
- `git config --show-origin --get-regexp '^core\.(autocrlf|eol|safecrlf|attributesfile)$'` → only `file:C:/Program Files/Git/etc/gitconfig core.autocrlf true` (system-level origin of the smudge).
- HEAD==index==worktree bytes for dataset (`6a581071…`) and policy (`2c870cfc…`) at inspection; manifest differed only because r2 was in progress.
- Decisive probe: `git cat-file blob HEAD:mathviz/docs/P5_3_SCORING_POLICY.md` is **byte-identical** under `core.autocrlf=true/false/input` and `core.eol=crlf/lf/native` (all `2c870cfc…`, 3434 bytes).

## Authority decision (owner-directed)

Freeze authority moves from checkout-dependent worktree bytes to **committed Git blob bytes**: `HEAD:<dataset>`, `HEAD:<scoring-policy>`, `HEAD:<manifest>` (or the preregistered freeze commit / staged index before Commit A). The verifier and the benchmark runner both read and parse the frozen blobs; worktree CRLF/LF becomes an advisory audit only. `.gitattributes` stays as hygiene, never as the trust basis. A provider-free regression test pins blob-byte invariance across `core.autocrlf`/`core.eol` configurations.

## Disposition

**P5.3 live verdict remains BLOCKED / NOT RUN.** Attempts 1–3 produced zero benchmark cases and zero A1/repair requests; none consumed the one independent sampling authorization. The credential path forward is: human rotates/revokes the old key on the provider side and explicitly confirms completion (attestation file `runs/p53/ROTATION_ATTESTATION.md`; never send the key through chat); then an auth/models-level probe with zero benchmark content; only freeze-r2 PASS + preregistration committed + rotation confirmed together authorize the single live run.

Earlier offline evidence remains: TypeScript passed; Vitest 215/215; full P0–P5.0 gates green; G17 PASS; v2 replay retains first-pass G19 calibration 169/171; v3 deterministic replay PASS.

---

## Attempt 4 (the authorized run): executed — verdict FAIL

- Date: 2026-09-28
- Amendment governing the credential row: **A1** (`docs/P5_3_LIVE_PROTOCOL_R2_AMENDMENT_A1_CREDENTIAL_GATE.md`), commit `16a45f7`.
- Gate invocation: `npm run gates:p53:live`
- Authorization: freeze preflight PASS (6/6) + preregistration PASS + `CREDENTIAL_EXPOSURE_ATTESTED` PASS + `PROVIDER_AUTH` probe PASS → **`LIVE AUTHORIZED = YES`**. G17 PASS 14/14.
- **Result: `G20_P5_3_benchmark_v3: FAIL (live)`. The 72-case batch ran to completion. This consumed the single independent sampling authorization.**

Five rows failed, all downstream of `supported_compile_success` 56/64 = 0.875 (needs ≥0.90): `core_semantic_match` 0.875, `goal_capability_accuracy` 0.8857, `final_schema_semantic_valid` 0.8889, `challenge_accepted_core_match` 17/24.

Localization and root cause are recorded in **`docs/P5_3_LIVE_FAIL_REPORT.md`**: the deficit is entirely `function2d` (15/22 = 0.682; `motion1d` 20/20, `geometry2d` 21/22). One recurring model failure mode accounts for all 10 semantic mismatches — `E_SOURCE_COMPLETENESS`, the model collapsing an explicitly declared function into an equation instead of materialising the declared entity. Golden defect is excluded (the contract is satisfiable, `motion1d` proves it).

Safety invariants all held: `answer_leaks` 0, **`silent_fidelity_errors` 0**, `repair_semantic_regressions` 0, `g19_final_grounding` 178/178, `unsupported_refused_correctly` 6/6. The failure was fail-closed and honest.

### Credential-row resolution (supersedes the forward path above)

The `ROTATION_ATTESTATION.md` path described in the Disposition section is **superseded by Amendment A1**. A1 re-derives the gate on the underlying risk — using a credential that has leaked — rather than on one remediation for it (rotation). Evidence is now the gitignored `runs/p53/CREDENTIAL_EXPOSURE_ATTESTATION.md` carrying `exposure-bounded-accepted` / `credential-not-exposed` and a `confirmed-at-utc:` line; it is an exposure finding only and must never be cited as rotation evidence. Rationale, including the owner's decision that rotating a credential shared across multiple agents and office machines is disproportionate, is recorded in the amendment and in `.learnings/LEARNINGS.md` (LRN-20260928-002).

### Binding constraint after Attempt 4

**No v3 golden, prompt, normaliser, threshold or case may be edited in response to these results** (scoring policy §43). A corrective change requires a **new benchmark version and a new preregistration**, and a fresh sampling authorization. Do not resume, rerun or selectively re-sample v3.

## Credential policy override disposition

The owner-provided `P5_3_Credential_Risk_Override_Plan.md` has been implemented as an operational authorization policy, not as a benchmark-result override:

- `STRICT`: rotation proof remains required.
- `DISPOSABLE_ACCEPTED`: explicit user risk acknowledgement, credential presence and provider auth are required; rotation proof is not required.
- Credential policy does not alter freeze integrity, preregistration, thresholds, scoring or the consumed one-run authority.
- `CREDENTIAL_POLICY_ACK.md` is gitignored and must be human-authored; environment flags are not evidence; keys are never logged.
- Because Attempt 4 already consumed the v3 live authorization and produced `docs/P5_3_LIVE_FAIL_REPORT.md`, the launcher now reports `SINGLE_RUN_AUTHORITY = FAIL` and will not reopen or rerun v3 under either credential policy. A corrective run requires a new benchmark version and new preregistration.
