# P4.1 + P5.0 Report — claim_point removal, fail-closed SymPy, ProblemSpec v1

Phase owner pipeline after this report:

```
NL problem -> [P5.1 LLM parser, NOT BUILT YET] -> ProblemSpec v1
          -> deterministic compiler (packages/spec) -> Math IR v1
          -> domain adapter -> Verified Domain Program -> Runtime/Scene
```

Everything below is verified by `npm run gates` (P0→P4→P5.0 chain, ALL
GREEN), `npm test` (156/156), and `npx tsc --noEmit` (clean), with the pinned
SymPy interpreter attached and no skip environment variables set.

---

## Part 1 — P4.1 hardening (three items from the e639748 audit)

### 1.1 `claim_point` removed from Math IR; facts project dynamically

The audit verdict was that `claim_point` was a drawing-motivated entity — the
Math layer was made to carry an entity whose only reason to exist was that
the Scene wanted to draw a point. That violated the frozen layering (Math IR
= mathematical facts; Scene IR = expression).

What changed:

- `DomainSnapshot` (packages/runtime/src/domain.ts) gains an optional
  `facts: Record<fact_id, DomainFactSnapshot>` layer: the per-state
  projection of a Math fact under the CURRENT runtime state. This is a
  cross-domain extension by construction — motion events and geometry
  dynamic facts can project through the same field later.
- Function2D evaluate now emits `facts[claim.id] = { kind, value, point }`
  (value = numeric reading under current parameter values or null when the
  claim is inactive; point = drawable position or null) and **no point
  entities at all**. The snapshot digest covers `facts`, so digest checks
  track fact motion.
- Binding resolution order for `math:fact:<id>...` is now frozen as
  **snapshot fact projection first, frozen Math fact object fallback**
  (packages/runtime/src/bindings/resolve.ts). A moving root point resolves
  from the snapshot; a static label value still resolves from the frozen
  fact.
- Scene point objects in all five P4 fixtures now bind
  `math:fact:<fact_id>.point` directly (entities `pt_*` deleted from the
  Math documents). The schema binding pattern already allowed the fact
  namespace — no schema change was needed.
- The renderer accepts plain `{x, y}` resolved bindings for point objects
  (fact projections are coordinates, not `{kind:"point", position}`), in
  `collectGeometry` and `posOf`.
- compile.ts now rejects any leftover `claim_point` entity with
  `E_CAPABILITY_UNSUPPORTED` — stale producers fail loudly instead of
  silently regressing.

Tests: `tests/p4.test.ts` "P4.1: fact projection replaces drawable entities
in Math IR" covers (a) no fixture contains claim_point, (b) re-adding one
fails compile, (c) snapshot facts carry value+point and entities are
curve-only, (d) inactive claims resolve null, (e) resolver order
snapshot→frozen, (f) missing fact id → E_BINDING.

### 1.2 SymPy: `solve()` fallback deleted; solution sets fail closed

Frozen rule in the worker (`packages/adapters/sympy/python/operations.py`):

| solveset result | verdict |
| --- | --- |
| `FiniteSet` (all elements provably real) | ACCEPT |
| `Union` of such finite sets | ACCEPT |
| `FiniteSet ∩ Reals`, every element provably real | ACCEPT |
| `ConditionSet` | `E_CAPABILITY_UNSUPPORTED` (no solve() fallback anymore) |
| `ImageSet`, `Interval`, anything else | `E_CAPABILITY_UNSUPPORTED` |
| any element whose reality is unproven (e.g. `sqrt(-a)`) | `E_CAPABILITY_UNSUPPORTED` |

Two supporting changes make that rule honest:

- All AST symbols are built `real=True` (`ast_in.py`). MathViz semantics are
  real-valued (ExactNumber is rational-only, parameters carry rational
  ranges), so this is faithful, and it lets SymPy PROVE reality: the sweep
  fixture's parametric roots `{a-1, a+1} ∩ Reals` collapse to a plain
  `FiniteSet`, while conditionally-real shapes stay visibly unproven.
- `_require_provably_real` refuses any solution element with
  `is_real is not True`.

This closed a real hole the new G13 negative caught: `x² + a = 0` over Reals
returns `Intersection({±sqrt(-a)}, Reals)`, which the old
"finite-set ∩ Reals → accept" branch happily accepted as a parametric
solution — smuggling an unresolved parameter condition (`a ≤ 0`) through as
if it were a fact. It is now refused (`conditionset_refused` row in G13).

Conditional/parametric solution sets stay out of scope until an explicit
`ConditionalSolutionSet` contract exists, exactly as directed.

### 1.3 Extremum classification: second-derivative sign only, no "flat"

`op_extremum` now classifies `f''(x*) > 0 → min`, `f''(x*) < 0 → max`, and
raises `E_CAPABILITY_UNSUPPORTED` when `f''(x*)` is zero or not provably
signed. The old `kind = "flat"` output is deleted: with f''=0 the point may
be a minimum (x⁴), a maximum (-x⁴), or neither (x³) — emitting a fake
"flat" verdict was a fabricated classification, not a fact.

The G13 TypeScript cross-check was updated to match: an inconclusive second
derivative on the TS side now REQUIRES that SymPy refused the point
(`ts_type: "undetermined"` → row fails if any point came back); the new
negative row `inconclusive_extremum_refused` feeds `x³` through the oracle
and asserts the refusal. G13 now runs 19 checks (17 positive + 2 new
fail-closed negatives), all green.

### 1.4 Regression surface

- P4 digests changed (function2d snapshots now include `facts`); P1/P2/P3
  snapshots are byte-stable — their domains emit no facts yet, which is the
  designed backward compatibility of the optional field.
- Full chain re-run with `MATHVIZ_PYTHON` set and no skip envs:
  P0 ALL GREEN, P1 ALL GREEN, P2 ALL GREEN, P3 ALL GREEN, P4 ALL GREEN.

---

## Part 2 — P5.0: ProblemSpec v1 designed and frozen (no LLM)

Per the audit direction: the LLM must never generate Math IR. It will parse
the problem into a **ProblemSpec** — source semantics + goals — and a
deterministic compiler produces the Math IR. This phase freezes that
contract and proves, on three handwritten specs (one per domain), that
ProblemSpec → Math IR v1 → Verified Domain Program compiles end to end with
the EXISTING frozen machinery. P5.1 (LLM parser) is deliberately out of
scope.

### 2.1 The frozen contract (`packages/contracts/schemas/problemspec.schema.json`)

A ProblemSpec may contain ONLY source semantics: `schemaVersion`,
`problemId`, `domain`, `statement`, `parameters`, `entities`,
`source_facts`, `constraints`, `goals`. It is structurally incapable of
carrying answers:

- `goals` items are `additionalProperties: false` with exactly
  `{goalId, capabilityId, inputs}` — there is no place to write a value, an
  expectation, or a result. Verified by the `goal_carries_answer_field`
  negative.
- The answer-bearing Math IR layers (`derived_facts`, `events`,
  `runtime_values`, `assertions`, `capabilities`, scene anything) are not
  properties of this object at all. Verified by
  `derived_layer_smuggled_into_spec`.
- `source_facts` must carry `problem_text` provenance with a span that is an
  exact slice of `statement` (schema requires the shape; the semantic
  validator checks the slice), and values must be ExactNumber objects.

The semantic validator (`packages/contracts/src/spec-validate.ts`) freezes:

1. every goal capability exists in the frozen registry (else
   `E_CAPABILITY_UNSUPPORTED`);
2. its domain matches the spec's domain (else `E_SCHEMA`) and its family is
   `solver` or `event` — presentation/verification families cannot pose as
   goals (`geometry2d.equal_mark` is rejected);
3. every goal input resolves to a declared source entity/fact (else
   `E_BINDING`);
4. goal ids are unique; goals are non-empty.

### 2.2 The deterministic compiler (`packages/spec`)

`compileProblemSpec(spec)` validates, passes the source layer through
verbatim, answers each goal with a domain solver, and emits a Math IR v1
document whose derived facts all carry `{kind:"derived",
capability_id, inputs}` provenance. No LLM, no clock, no randomness: two
compiles are canonically byte-identical (asserted by G16 and tests).

Goal solvers wired in v1 — deliberately NOT SymPy (the oracle must stay
independent; making it the production solver would let the system grade its
own homework):

- **function2d.solve_equation** — exact bigint rational-root solver
  (`poly.ts`). The equation must reduce to a rational-coefficient polynomial
  (degree ≤ 8) over `+ - * / ^`; free parameter symbols are REFUSED (they
  are the ConditionalSolutionSet case). Completeness certificate: after
  extracting every rational root by exact division, the residual must be a
  non-zero constant — `x²-2=0` and `(x-2)(x²+1)=0` are refused rather than
  under-reported, even though SymPy could solve them. Every accepted root is
  additionally re-verified by exact substitution through the frozen runtime
  evaluator (independent code path).
- **motion1d.meeting/overtake/reach events** — bootstraps the EXISTING
  frozen motion compiler: solves the event without a declared time, harvests
  the exact time/position, then emits the event `at` plus the two derived
  facts (time under the event capability, position under
  `motion1d.solve_position` referencing the time fact). The final document
  is re-compiled, and that same compiler re-verifies both facts exactly.
- **geometry2d.derive_length** — exact rational distance between two static
  points with rational literals (`"6"`, `"-3/4"`); bigint perfect-square or
  symbolic `sqrt` ExprAst otherwise; irrational DSL expressions like
  `"3*sqrt(2)"` are refused as the v1 boundary.

### 2.3 Three-domain handwritten proof

`fixtures/spec/`:

- `function2d-solve.spec.json` — 解方程 x²−5x+6=0 → compiled facts
  `solve_main_sol_1 = 2`, `solve_main_sol_2 = 3` (exact ints), Math IR
  passes G1/G2/G3, `compileFunction` verifies both claims at compile time.
- `motion1d-meeting.spec.json` — 甲 0 m @ +5 m/s, 乙 100 m @ −5 m/s →
  event `meet` at t = 10 s, facts `meet_time = 10`, `meet_pos = 50`,
  re-verified by `compileMotion`'s exact solver.
- `geometry2d-length.spec.json` — A(0,0), B(6,8) → `len_length = 10` exact,
  document still compiles under `compileGeometry`.

Each is checked against an independent numeric recomputation written by hand
in the gate runner (double-entry: solver vs formula), not against the
compiler's own output.

### 2.4 Gates

- **G15_spec_contract** — 3 valid specs pass schema + semantics; 8 frozen
  negatives fail on exactly the expected codes: answer-bearing goal
  (E_SCHEMA), smuggled derived layer (E_SCHEMA), unknown capability
  (E_CAPABILITY_UNSUPPORTED), cross-domain capability (E_SCHEMA),
  presentation capability as goal (E_CAPABILITY_UNSUPPORTED), dangling input
  (E_BINDING), empty goals (E_SCHEMA), span not a statement slice
  (E_PROVENANCE).
- **G16_spec_deterministic_compile** — per domain: deterministic compile ✓,
  emitted Math IR passes gateSchema/gateProvenance/gateCapability ✓,
  existing domain adapter produces the Verified Domain Program ✓,
  independent numeric agreement ✓.

Runner: `npm run gates:p50` (artifacts under `runs/p50/`), wired into the
top-level `npm run gates` chain after P4.

### 2.5 Test suite

`tests/spec.test.ts` (10 tests): contract acceptance/rejection, three-domain
compile results, determinism, and the fail-closed solver boundaries
(x²−2 refused, (x−2)(x²+1) refused, 0=0 refused, x²+1 refused, parametric
symbol refused, (3/2)x−3 = 0 → x = 2 accepted, irrational DSL coordinate
refused, unwired goal capability refused).

Full suite: **156/156 green**, `tsc --noEmit` clean.

---

## What is deliberately NOT here

- **P5.1 LLM parser** — not started, per the phased directive. The ProblemSpec
  schema + validator + compiler are the surface it will target.
- **ConditionalSolutionSet contract** — parametric/conditional solution sets
  remain refused everywhere (worker and spec compiler) until that contract is
  explicitly designed.
- Scene/timeline generation from a compiled spec — ProblemSpec compiles to
  Math IR and Verified Domain Programs in this phase; the teaching-facing
  Scene layer stays a later concern (P6).
