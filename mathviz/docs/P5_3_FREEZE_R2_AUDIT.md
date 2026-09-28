# P5.3 Freeze Revision R2 — Git-Blob Authority Audit

## Why r2 exists

R1 froze benchmark v3 semantics and then blocked **before any provider request**: Git stored LF blobs, but this Windows machine (system gitconfig `core.autocrlf=true`) smudged the scoring-policy checkout to CRLF, so a worktree-byte verifier saw `2c870cfc…` where the r1 manifest pinned `e6ae3225…`. A later launcher test failed resolving `tsx` before G17. Attempts and the formal pause status (`NOT FROZEN / NONE / NOT RUN / NOT GRANTED / 0-0-0`) are recorded in `runs/p53/LIVE_BLOCKED.md`. None consumed the one sampling authorization.

## Authority model (owner-directed)

**Freeze authority = committed Git blob bytes.** For every frozen artifact the chain is:

```
frozen Git blob (git cat-file blob <freeze-commit>:<path>)
  → SHA-256
  → freeze manifest r2
  → preflight verifies the SAME blob
  → runner parses the SAME blob as the benchmark dataset
```

- The verifier (`packages/parser-benchmark/src/freeze-v3.ts`) hashes blobs at the pinned commit (default `HEAD`; `:` = staged index pre-commit). It never reads worktree bytes for authority.
- The runner (`run-v3.ts`) parses the dataset from the same frozen blob, eliminating any manifest-vs-runner representation gap.
- Worktree CRLF/LF and `.gitattributes` remain **hygiene/audit only**; acceptance correctness no longer depends on any machine's checkout behavior.
- Empirical basis: `git cat-file blob HEAD:mathviz/docs/P5_3_SCORING_POLICY.md` is byte-identical (`2c870cfc…`, 3434 bytes) under `core.autocrlf=true/false/input` and `core.eol=crlf/lf/native`. A Vitest regression (`tests/freeze-v3-blob-authority.test.ts`) pins this invariance provider-free.

## r2 change boundary

Only the byte-authority contract and gate plumbing change; benchmark semantics are untouched (no v4, no case or threshold edits):

- manifest `hash_authority: "git-blob-bytes"`, `freeze_revision: "v3.1"`, `manifest_revision: 2`;
- dataset/policy/identity hashes are **blob** SHA-256 values (identity = G19/G20/pipeline source blobs);
- manifest self-check: SHA-256 over the canonical JSON with `manifest_sha256` blanked;
- `gates:p53:freeze-preflight` (HEAD) and `gates:p53:freeze-preflight:staged` (index, pre-Commit-A) — provider-free;
- golden audit recomputed over the staged dataset (72/72 required) at generation time;
- single-run launcher enforces the owner's gate table and stops before G17/A0/A1/benchmark on any non-PASS row;
- provider auth probe (`scripts/check-provider-auth.mjs`) hits only `GET /models` with zero benchmark content.

## Commit sequence

1. **Commit A** — `.gitattributes` (hygiene), manifest r2 (blob hashes), blob-authority verifier/preflight/generator/runner, launcher, auth probe, regression test, this audit, updated blocked record. Validated pre-commit by `gates:p53:freeze-preflight:staged` over index blobs; re-validated post-commit by `gates:p53:freeze-preflight` over `HEAD` on a clean tree.
2. **Commit B** — fresh preregistration `docs/P5_3_LIVE_PROTOCOL_BLOB_R2.md` plus machine-readable pin `fixtures/parser-bench-v3/live-pin-r2.json` citing Commit A. The earlier placeholder draft is retained only as an UNREGISTERED DRAFT under ignored `runs/p53/` and is not part of any commit.
3. **Credentials (human)** — confirm, via the gitignored attestation file `runs/p53/CREDENTIAL_EXPOSURE_ATTESTATION.md`, that the credential used for the run has not been exposed (or that any exposure is bounded and accepted); then the auth probe. Env flags are never credential evidence. **Amended by A1**: this row was originally a provider-side key **rotation** attestation; see `docs/P5_3_LIVE_PROTOCOL_R2_AMENDMENT_A1_CREDENTIAL_GATE.md`, which re-derives the gate on the exposure risk itself and renames the row `KEY_ROTATION_CONFIRMED` → `CREDENTIAL_EXPOSURE_ATTESTED`. Frozen artifacts are unchanged by A1.
4. Only freeze PASS + preregistration + credential exposure attestation together authorize the single 72-case run.
