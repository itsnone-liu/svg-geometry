# MathViz P5.0.1 + P5.1 Report — Parser Surface Hardening & LLM Semantic Parser

- Baseline: P4.1 `eed97a8`, P5.0 `827e54d` → P5.0.1 `f967d75` → P5.1 (this report's commit)
- Acceptance (task book §35): given an NL math problem inside the three-domain capability boundary, the LLM only compiles it into an answer-free, traceable ProblemSpec; all answers come from the deterministic compiler and domain solvers. Even a wrong LLM output can only be rejected or repaired at the ProblemSpec Gate — it can never directly pollute Math IR, Scene, or Runtime.

## P5.0.1 — Parser Surface Hardening (commit f967d75)

The input contract was closed BEFORE any LLM was attached, so "模型可以写什么" is not a prompt suggestion but a schema+validator fact:

| Surface rule | Where enforced | Evidence |
|---|---|---|
| `SourceEntity.props` allow-listed per kind (geometry point/segment/line/circle, motion body+segments, function function/equation) | schema `allOf` if/then branches, `additionalProperties:false` | `answer_smuggled_into_props` fails **at the schema level** (negative case) |
| Unknown prop → E_SCHEMA, never ignored | schema | `entity_unknown_prop` |
| Every entity & constraint carries `problem_text` provenance; spans are exact slices | schema (required) + validator (`E_PROVENANCE`) | `entity_without_provenance`, `entity_bad_span`, `constraint_without_provenance` |
| Constraint `params` forbidden outright (no wired capability consumes them) | schema | `constraint_unknown_param` |
| Duplicate entity/fact/parameter/goal ids | validator `E_SCHEMA` | 3 negative cases |
| Intra-entity reference closure (segment/line endpoints, circle center, body fact refs, parameter_bindings) | validator `E_BINDING` | `dangling_entity_internal_ref`, `internal_ref_wrong_kind`, `body_fact_ref_dangling` |
| Expression symbol closure (variable + declared params + pi/e) | validator `E_BINDING` | `undeclared_expression_symbol` |
| Domain entity-kind whitelist (registry existence ≠ parser may emit) | validator `E_SCHEMA` | `cross_domain_entity_kind`, `goal_capability_not_on_compiler_surface` |
| Spec-layer provenance stripped when compiling to Math IR (frozen Math entity schema has no such field) | `compile.ts` | test `compiled Math IR no longer carries spec-layer provenance` |

15 new negative cases (G15 loads both sets), 3 valid fixtures re-signed with entity provenance, 162/162 tests, G15/G16 green. Provenance division of labor frozen: entity provenance anchors structure/expression/relation; fact provenance anchors independent numbers; spans may overlap.

## P5.1 — LLM Semantic Parser

### Architecture (LLM 理解题目，solver 答题)
- `packages/parser` — provider-neutral core. The core never binds to a model API.
  - `types.ts` — `StructuredLLMProvider`, token usage, 7-class error taxonomy (`DOMAIN_ERROR`, `JSON_ERROR`, `SCHEMA_ERROR`, `PROVENANCE_ERROR`, `BINDING_ERROR`, `CAPABILITY_ERROR`, `COMPILER_UNSUPPORTED`).
  - `provider.ts` — `OpenAICompatibleProvider` (live; env `MATHVIZ_LLM_BASE_URL/API_KEY/MODEL`), `ScriptedProvider` (deterministic contract tests), `GoldenProvider` (replay). Defensive markdown-fence stripping; JSON-only output contract.
  - `prompt.ts` — frozen policy `p5.1-policy-v1` + contract `mathviz.problemspec/v1+p5.0.1`. The model sees: statement, domain, Compiler-Surface capabilities only, entity-kind prop guide, unit vocabulary, one frozen few-shot per domain. Never sees: answers, solver outputs.
  - `parse.ts` — two logical calls: A0 domain routing, A1 spec generation; deterministic validation between every step (schema → semantics → compile). Repair ≤ 1: model gets structured errors (`code`/`path`/`message`) and must return a COMPLETE spec; `repairDelta` (changed top-level paths) recorded. Outcome taxonomy: `PARSER_ACCEPTED` / `ENGINE_UNSUPPORTED` (valid spec, engine refuses — **not a parser failure**; covers `E_CAPABILITY_UNSUPPORTED` and `E_MATH_CONSTRAINT`) / `PARSE_FAILED`.
  - `telemetry.ts` — usage accounting; deterministic validated-spec cache keyed `sha256(contract + policy + provider + statement)` (only VALIDATED specs cached); `leakScan` (belt-and-braces answer-channel scan).
- `packages/parser-benchmark` — `normalize-spec.ts` semantic normalizer (stable renaming, exact-number normalization incl. fact values, AST canonicalization with neutral-term dropping, exact unit conversion km/h→m/s) + G18 runner.

### ProblemSpec Compiler Capability Surface
Frozen in `spec-validate.ts`: geometry2d `derive_length`; motion1d `meeting/overtake/reach_event`; function2d `solve_equation`. Registry existence ≠ emittable: `geometry2d.midpoint` as a goal → `E_CAPABILITY_UNSUPPORTED`. The prompt exposes exactly this list.

### G17_parser_contract (deterministic, ScriptedProvider, zero tokens)
- S1 answer-bearing goal → refused, repaired → accepted
- S2 smuggled `derived_facts` → refused, repaired → accepted
- S3 fenced JSON tolerated; S4 garbage → JSON_ERROR → repaired
- S5 valid-but-unsupported (x²−2=0) → ENGINE_UNSUPPORTED, spec kept auditable
- S6 unrepairable → fails after exactly ONE repair (3 provider calls total)
- S7 `MAX_REPAIRS === 1` frozen; S8 cache hit (0 provider calls); S9 DOMAIN_ERROR surfaces
- Answer leakage across all accepted specs: **0**
→ **PASS**

### G18_parser_benchmark — 60 frozen cases (20/domain: 10 straightforward + 5 wording + 3 irrelevant + 2 unsupported-but-parsable)
Every golden self-checked at generation: schema + semantics + compile (or the exact expected engine refusal).

**Executed mode: replay** (no LLM API key in this environment; the neighbor project's key was deliberately NOT borrowed). Replay drives the ENTIRE deterministic pipeline — routing plumbing, schema/semantic/compile gates, repair machinery, normalization, metric computation — with the frozen goldens as model answers. Results: domain 100%, schema+semantic valid 100%, semantic match 100%, goal-capability 100%, supported compile 100%, unsupported correctly refused 6/6, leakage 0. **These are plumbing checks, not model-quality claims** (§33): the honest quality number requires the live mode below.

**Live mode** (ready, unrun here): set `MATHVIZ_LLM_BASE_URL`, `MATHVIZ_LLM_API_KEY`, `MATHVIZ_LLM_MODEL` (any OpenAI-compatible endpoint) and rerun `npm run gates:p51`; the same thresholds (schema ≥98%, semantic ≥95%, goal-cap ≥95%, supported compile ≥90%, leakage 0) apply.

Notable replay-mode catch: the first GoldenProvider implementation inferred the case from prompt text and got hijacked by the embedded few-shot statement (fx_un_01 silently answered by fx_sf_04's golden). Fixed by per-case provider construction — ambiguity now impossible by construction. This is exactly the class of silent-correctness bugs the benchmark exists to catch.

### Tests
177/177 (`tests/parser.test.ts`: provider behaviors, taxonomy split, repair cap, cache key binding, leakage scan, normalizer equivalences & non-equivalences). `tsc --noEmit` clean. Full chain `npm run gates` P0→P5.1 ALL GREEN with SymPy + Chrome, no skip envs.

## Not done (per scope)
- No Scene/Timeline/teaching text/animation (P6).
- No live-model quality numbers (no API key in env; harness ready).
- Repair-loop model-behavior tuning, prompt-policy iterations (P5.2 territory once live runs exist).
