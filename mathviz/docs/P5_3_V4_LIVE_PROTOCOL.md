# P5.3 Benchmark v4 — Live Protocol (Stage-D Preregistration, Git-Blob Authority)

Status: **PREREGISTERED (this commit)**. P5.3 v4 benchmark + parser acceptance
surface is **FINAL FROZEN**; this protocol authorizes exactly one independent
live acceptance batch against that frozen surface and nothing else.

## Status at registration

- P5.3 v4 freeze = **FINAL** at freeze commit
  `877bf6dd0ee30d4adca62d79cded0eaf657edf64` (user-declared after remote audit
  of itsnone-liu/svg-geometry; C2.4 provider-free preflight 12/12 PASS at that
  commit, report retained under ignored `runs/p53/preflight-v4-report.json`).
- Freeze authority = **freeze commit `877bf6d` + `freeze-v4.json` at that
  commit + the 13 raw Git blobs referenced by the manifest**. No new freeze SHA
  may ever be minted: later commits only reference `877bf6d`.
- P5.3 v4 stage record: Stage-A COMPLETE; Stage-B PASS; Stage-B.1 PASS;
  C1 PASS; C2.0–C2.4 PASS (C2.2 dual-denominator ruling: accepted-core
  denominator is DUAL_COMPILE_OK = 11; 13 and 15-as-accepted are invalid).
- P5.3 v4 preregistration = **THIS COMMIT** (+ machine-readable pin
  `fixtures/parser-bench-v4/live-pin-v4.json`).
- P5.3 v4 live = **NOT RUN, NOT AUTHORIZED**. Zero provider benchmark requests
  have been issued for v4: cases executed = 0, A1 calls = 0, repair calls = 0.
- P5.3 v3 remains **FROZEN FAIL** (its single live authorization was consumed
  by Attempt 4); this v4 protocol is the new-benchmark-version corrective path.

## Frozen surface (authority = raw Git blobs at freeze commit 877bf6d)

- Benchmark `mathviz-p53-parser-benchmark/v4`; 72 cases; `MAX_REPAIRS = 1`.
- Freeze manifest `fixtures/parser-bench-v4/freeze-v4.json`
  (blob SHA-256 `29450dc7950b823b45392eabf30917c881120e3bf0c2a80ab4ad0b49e85c6233`)
  binds **13 authority blobs** in six groups DATA / POLICY / SCORER / V4_PARSER /
  DETERMINISTIC_KERNEL / AUDIT, each as path + git_blob_oid +
  sha256_raw_blob_bytes + byte_size. The manifest has no self-hash field.
- Dataset `fixtures/parser-bench-v4/cases.json`: blob OID
  `fce7be001c72079b22b62bf6f066a3ccf35d3c56`, SHA-256
  `05a76cae6ecedd0fe7c4b474399d9ca301303121e4eeca2ecc32fab34e934a78`.
- Scoring policy `docs/P5_3_V4_SCORING_POLICY.md`: SHA-256
  `2f3a560392910238aa850e08ff4d1ef0f2f93bec7d93cbf173f5500cddd90f0f`.
- Denominators (derived from the dataset blob, fixed): TOTAL 72;
  COMPILE_OK 64 / ENGINE_UNSUPPORTED 6 / KNOWN_LIMITATION 2;
  goal-capability eligible 70; DUAL_ALL 15 = DUAL_COMPILE_OK 11 +
  DUAL_ENGINE_UNSUPPORTED 2 + DUAL_KNOWN_LIMITATION 2; bare-equation controls 9.
- Prompt identity (v4 has no standalone version constant; this composition is
  the identity, and is stronger than a single string):

  ```
  v4_prompt_identity:
    base_version:  p5.3-policy-v1
    base_blob:     packages/parser/src/prompt.ts
                   oid 7f5afaef81c5bf7eec929026bf99c5570f932154
                   sha256 b1467e86509e3fc095cf6eb833379d93ab082c22f98070ed9875a6d5b5d14f63
    overlay_blob:  packages/parser/src/prompt-v4.ts
                   oid dde82a580bd7826ce5d65184562bc9ba116be0f9
                   sha256 25227661589c23493208a951780a30a5f0924a07971261c39590e4bc17831abe
  ```

- Model: `deepseek-v4.1-flash` at the preconfigured OpenAI-compatible endpoint;
  report model id + endpoint only, never the key.
- Construction provenance (`scripts/generate-v4-fixtures.mjs`) and run evidence
  (`runs/p53/*`) are NOT authority; live never regenerates the dataset.
- Verifier, preflight and runner all parse the SAME frozen blobs
  (`git cat-file blob 877bf6d:<path>`); worktree EOL is audit-only.

## Acceptance gates — conjunctive, unchanged from frozen C2.2 policy

Over 72: final expected-outcome validity ≥ 98%.
Over 64 COMPILE_OK: core semantic match ≥ 95%; supported compile success ≥ 90%.
Over 70 goal-capability eligible: goal-capability accuracy ≥ 95% (from
`finalCandidate`, engine-unsupported included).
Exact: engine refusal 6/6; known-limitation rejection 2/2; G19 final grounding
≥ 98.5%; answer leaks = 0; silent fidelity errors = 0; repair semantic
regressions = 0; unsupported semantic corruption = 0; max repair calls ≤ 1.

Dual subpopulation gates (exact, from the C2.2 ruling):

- `dual_compile_ok_accepted_core = 11/11` (A: expected COMPILE_OK ∧ final
  status PARSER_ACCEPTED ∧ finalCandidate semanticEqual golden);
- `dual_engine_unsupported_correct = 2/2` (B: never accepted; final status
  ENGINE_UNSUPPORTED ∧ semanticEqual golden ∧ refusal = declared expected_error
  ∧ parser-owned errors = 0);
- `dual_known_limitation_correct = 2/2` (C: never accepted; PARSE_FAILED ∧ G19
  ∧ E_PROVENANCE_GROUNDING ∧ declared failure family);
- `dual_detected_or_correct = 15/15`; `bare_equation_overconstraint = 0/9`.

Any silently accepted incorrect dual structure is a global failure.

## Credential protocol (human-owned; no env-flag shortcuts)

`CREDENTIAL_POLICY = DISPOSABLE_ACCEPTED` for this run, per the standing
credential override policy: explicit user risk acknowledgement required
(human-authored, gitignored `runs/p53/CREDENTIAL_POLICY_ACK.md`, scope
`P5.3_V4_INDEPENDENT_LIVE_ONLY`), credential presence required, provider auth
required (`npm run p53:provider-auth-check`), rotation proof NOT required.
Environment flags are never credential evidence; the key is never sent through
chat, committed, or printed. Credential policy changes nothing about scoring,
thresholds, benchmark validity, or the one-run rule.

## Run discipline (single-run authority)

1. One independent live batch over the frozen 72 cases; single pass, in order.
2. No selective retry; no per-case rerun; no restart-on-FAIL.
3. No edits to prompts, scorer, goldens, thresholds, dataset, or manifest at
   any point after freeze — any such edit voids the run.
4. Whatever the outcome, the complete PASS-or-FAIL result is committed with
   full per-case evidence; no second sampling.
5. Execution order is fixed: freeze (COMPLETE) → this preregistration
   (commit + push + remote audit) → credential acknowledgement → provider
   auth → explicit single-run authorization by the owner → one live batch.
   No step may be reordered or skipped.
