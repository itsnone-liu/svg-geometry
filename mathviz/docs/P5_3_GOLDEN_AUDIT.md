# P5.3 v3 Golden Audit

Status: pre-live audit record; benchmark is frozen in `fixtures/parser-bench-v3/freeze-v3.json`.

## Mechanical audit

`npx tsx scripts/freeze-v3.ts` checked each golden through `attemptCompile`, including the schema, semantic validator, deterministic compiler, G20 and G19. Result: **72/72 expected outcomes**.

- 64 `COMPILE_OK` cases: accepted through all gates.
- 6 `ENGINE_UNSUPPORTED` cases: clean, expected compiler refusal.
- 2 `KNOWN_LIMITATION_EXPECTED_REJECT` cases: fail closed on G19 provenance grounding.
- Domain quotas: geometry2d 24, motion1d 24, function2d 24.
- Each domain: 8 straightforward, 4 wording, 4 irrelevant, 4 compositional, 2 unsupported, 2 harder-repair/known-limitation.
- Challenges: exactly six each for declared entity completeness, irrelevant grounded distractor, expression term loss, and multi-finding/one-repair.
- IDs are unique; no v2 case IDs or goldens are reused.

## Manual semantic review

All 72 statement/golden summaries were reviewed against the source text, goal and intended expected status. This included checking every coordinate pair and geometry segment reference; each motion initial position, signed velocity, target, body and goal reference; each Function2D equation/function expression and declared function name/variable; and the explicit distractors and expected-unsupported cases.

Specific checks:

- Geometry cases use exact source spans for A/B coordinates; when the literal `AB` label is absent, the segment evidence spans both declared endpoints. C points in compositional/challenge statements are intentionally not in the requested AB goal closure.
- Supported motion goldens cite positions and local direction/signed-velocity phrases. `m3_kl_01` and `m3_kl_02` encode direction only relationally (“相向”), so each body lacks locally supported sign evidence; both are predeclared expected G19 fail-closed cases and excluded from ordinary core-match.
- Function zero cases preserve the named function as a separate function entity and represent the requested `f(x)=0` equation. `f3_cp_03` and `f3_cp_04` also include a separate explicit equation as a second goal/entity, so both declarations and distinct source equations are represented.
- Unsupported motion overtake, unsupported signed reach, unsupported irrational geometry distances and irrational-root equations are accepted by schema/semantics then refused by the frozen compiler; their expected refusal was confirmed by full-chain audit.
- Irrelevant numeric distractors are omitted from goldens and are not goal dependencies. Challenge cases cover all three domains.

## Known audit boundary

The programmatic audit proves that the selected golden is contract-valid and has the declared expected disposition; it cannot prove that every alternative interpretation of natural-language wording is impossible. The two relational-direction motion cases deliberately document the known limitation. No live output was used to edit or select goldens. Any discovered defect after live starts requires a new benchmark version and preregistration.
