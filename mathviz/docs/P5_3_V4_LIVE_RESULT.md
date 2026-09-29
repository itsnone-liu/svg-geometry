# P5.3 v4 Independent Live Result — FAIL

**Run:** `P5.3_V4_INDEPENDENT_LIVE`  
**Authorization:** one issued by the owner; **CONSUMED** at `2026-09-29T00:27:33.622Z` on the first benchmark provider `generate()` dispatch.  
**Freeze authority:** `877bf6dd0ee30d4adca62d79cded0eaf657edf64` (verified freeze commit).  
**Preregistration:** `0b9dc3a3132b990e98609640bdb4f52feadf61db`; launch HEAD was `46b47364c33f519f531fefa6a2a9765919b5bec2`.  
**Model:** `deepseek-v4.1-flash`; 72 frozen-order cases completed; one pass only.  
**Verdict:** **FAIL**. No retry, rerun, restart, selective case rerun, or result repair was performed. This live authorization is spent.

## Launch gates and execution

- First attempted launch stopped at local preflight because `BLOB_IDENTITIES_MATCH` correctly reported the worktree dirty (the live execution layer was not yet committed). It issued **zero benchmark requests** and wrote no consumption marker; this was before the authorized sampling point.
- Live infrastructure was committed as `46b4736`; the next launch passed all 13 prereg checks, credential acknowledgement, provider auth, and G17. Freeze raw-blob identities matched and worktree was clean.
- Provider auth was HTTP 200 / model listed. Benchmark request chain then completed all 72 cases. Consumption marker records the first request time above.
- Full raw evidence: `fixtures/parser-bench-v4/live-evidence/benchmark-v4.json`, `benchmark-v4-rows.json`, `benchmark-v4-diagnostics.json`. These are copied verbatim from the gitignored run outputs; no edits or recomputation.

## Metrics

| Gate / metric | Result | Required / threshold | Status |
|---|---:|---:|---|
| Cases completed | 72/72 | 72 | PASS |
| Expected/actual class matrix | 64/72 | 72/72 | FAIL |
| Final schema semantic validity | 64/72 (88.89%) | >=98% | FAIL |
| Core semantic match | 57/64 (89.06%) | >=95% | FAIL |
| Supported compile success | 58/64 (90.63%) | >=90% | PASS |
| Goal capability accuracy | 70/70 (100%) | >=95% | PASS |
| Dual detected or correct | 13/15 | 15/15 | FAIL |
| Dual A compile-ok accepted core | 4/11 | 11/11 | FAIL |
| Dual B engine-unsupported correct | 0/2 | 2/2 | FAIL |
| Dual C known-limitation correct | 0/2 | 2/2 | FAIL |
| Bare equation overconstraint | 0/9 | 0 | PASS |
| Engine unsupported correct | 5/6 | 6/6 | FAIL |
| Known limitation correct | 0/2 | 2/2 | FAIL |
| G19 final grounding | 247/255 (96.86%) | >=98.5% | FAIL |
| Answer leaks | 0 | 0 | PASS |
| Silent fidelity errors | 1 | 0 | FAIL |
| Repair semantic regressions | 10 | 0 | FAIL |
| Maximum repairs per case | 1 | <=1 | PASS |

Full exact per-case gates and metrics are in the committed JSON evidence. The raw diagnostics contain all 72 case outputs, request IDs, provider raw text, parsed candidates, parser errors, and per-call usage.

## Notable declaration/outcome mismatches

- `v4_f_01`: expected `ENGINE_UNSUPPORTED`, actual `KNOWN_LIMITATION_EXPECTED_REJECT`; errors include `E_SOURCE_COMPLETENESS`, `E_FUNCTION_ZERO_FUNCTION_MISSING`, `E_CAPABILITY_UNSUPPORTED`, `E_PROVENANCE_GROUNDING`.
- `v4_f_03`: expected known limitation, actual `COMPILE_OK`.
- `v4_f_08`, `v4_f_10`, `v4_f_12`–`v4_f_15`: expected `COMPILE_OK`, actual parse rejection from source completeness/function-zero/provenance errors.
- `v4_f_05`: accepted but not golden core match.
- `v4_f_02`: `ENGINE_UNSUPPORTED`, but not core-match / declared dual-B correctness.

These are reported as observed; no declarations, thresholds, frozen artifacts, or result files were changed to make them pass.

## Evidence accounting caveats (preserved, not repaired)

The runner's summary currently reports token totals as zero even though the raw per-call diagnostics record usage. It also labels the manifest's `generated_from_commit` (`29aedb25c6bbd530f58760ac838ecec4871e2ec3`) as `freeze_commit`; the independently verified authority commit is `877bf6dd0ee30d4adca62d79cded0eaf657edf64`, which is correctly present in `freeze_verified_commit` and the consumption marker. Preserve this run as-is: correcting runner/report fields now would be a result edit and cannot change the consumed verdict.

**Final status:** `P5.3_V4_INDEPENDENT_LIVE = FAIL`; authorization count 1, consumed; benchmark requests were issued; no further live execution is authorized by this consumed authorization.
