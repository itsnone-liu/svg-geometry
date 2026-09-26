# MathViz P4 Report — Function2D + Node-only SymPy Oracle

## Outcome

**P4: ALL GREEN.** The Function2D domain runs through the existing generic `DomainAdapter` / `Runtime` pipeline, with deterministic frame-independent snapshots. SymPy 1.14.0 is used only by the Node freeze runner as an independent symbolic oracle; the browser bundle contains no Python, SymPy, or `child_process` code.

Acceptance path:

```text
Function Math IR
  → Function2D DomainAdapter.compile()
  → VerifiedFunctionProgram
  → pure evaluate(modelTime) / FunctionSnapshot
  → generic RuntimeState bindings
  → cartesian_window + SVG renderer
```

## Contract and architecture review

No Math IR or Scene IR contract issue was found, so no schema/version change was needed:

- Math v1 already permits domain payloads in `MathEntity.props` and includes `function2d` as a domain.
- Scene v1 already reserves `layoutRules` as an array of objects and already includes `axis`, `grid`, `point`, and `function_curve` primitives.
- P4 adds a semantic `cartesian_window` gate without changing the Scene v1 outer schema.
- `Runtime` remains domain-agnostic; no `domain === "function2d"` branch was added. The DomainAdapter interface is unchanged.

A `claim_point` Math entity declares a drawable, globally unique scene anchor that refers to a derived fact. Its geometry is emitted by the FunctionSnapshot and resolved using the existing snapshot-first entity-binding behavior.

## Function2D behavior

Implemented all eight registry capabilities:

1. `function2d.expression_curve`
2. `function2d.roots`
3. `function2d.intersection`
4. `function2d.derivative_at`
5. `function2d.extremum`
6. `function2d.parameter_sweep`
7. `function2d.value_at`
8. `function2d.solve_equation`

The compiler checks variable/parameter separation, exact finite x-domain bounds, declared capabilities, parameter bindings, claim inputs and claim value symbols. Frozen candidate facts are revalidated numerically over deterministic parameter samples. Runtime assertions recheck claims against the current parameter state. Completeness and exact symbolic equivalence are reserved for G13; the runtime adapter does not pretend numeric substitution proves completeness.

Sampling is frozen at **257 independently evaluated points** and `FUNCTION_EPS = 1e-9`. Samples are computed from the fixed finite x-domain, independent of DOM size and previous samples. Expression errors/non-finite results create polyline breaks; the implementation does not infer asymptotes.

Parameter sweep uses the explicit chain `presentation time → model time t → runtime value a_at_t → parameter a → curve/claims`. An unbound parameter uses its declared default. A runtime binding that is null outside its mapping window creates an inactive curve (`segments: []`) and null claim positions; it does not silently substitute `t` for the parameter.

## Symbolic differentiation and support boundary

TypeScript differentiates the frozen ExprAst subset: `+ - * / ^` (integer constant exponents only), `neg`, `sin`, `cos`, `tan`, `exp`, `ln`, and `sqrt`. Unsupported differentiation (including `abs` and variable exponents such as `x^x`) fails with `E_CAPABILITY_UNSUPPORTED`; numerical differencing is not used as a substitute for mathematical facts.

P4 equations are represented as `equation` entities with `lhs`, `rhs`, and `variable`. Parameterized equations are outside this P4 contract and fail closed. Each frozen solution candidate is checked by substitution in TypeScript; the independent SymPy oracle checks the returned solution set and rejects non-finite/incompletely enumerable sets.

## SymPy adapter and security boundary

`packages/adapters/sympy/` provides a persistent JSON Lines worker (`mathviz.sympy/v1`) and a Node client/oracle. The Python worker accepts only explicit MathViz ExprAst trees; it uses an allow-listed node/operator mapping and never calls `eval`, `exec`, `sympify(raw_user_text)`, or `parse_expr`. Responses use MathViz ExactNumber, ExprAst, FiniteSolutionSet, and extrema-list structures, never Python `repr` as a machine value.

The worker and freeze runner enforce **`sympy == 1.14.0`**. Roots/intersections/equations use exact solution-set operations, derivatives use `diff`, value-at uses exact substitution, and symbolic comparisons use `simplify(lhs-rhs) == 0`. A non-finite result such as `tan(x)=0` returning an ImageSet is rejected with `E_CAPABILITY_UNSUPPORTED`.

The browser entry imports only Runtime, the Function2D adapter, and the SVG renderer. A post-build scan of `examples/p4/dist/runtime.bundle.js` found no matches for `child_process`, `node:child_process`, `sympy`, `python`, or `spawn(`.

## Cartesian window and renderer

Every P4 Function2D fixture passes a semantic gate requiring exactly one `cartesian_window`, with finite bounds and `x_max > x_min`, `y_max > y_min`. Missing, duplicate, or invalid windows produce `E_LAYOUT`. The renderer reads a valid window for stable world-to-pixel mapping and paints axes, integer grid lines, sampled curve polylines, and snapshot points. It consumes sampled snapshot data only: it does not evaluate expressions, solve roots, differentiate, or find extrema.

## Fixtures and verification

Delivered fixtures:

- `quadratic-sweep.compiled.json`: `f_a(x)=(x-a)^2-1`, `a∈[-2,2]`, `a(t)=-2+4t`; symbolic roots and moving vertex.
- `intersections.compiled.json`: `x^2` and `2x+3`; intersections at `x=-1,3`.
- `derivative-extrema.compiled.json`: `x^3-3x`; stationary extrema, `f'(2)=9`, and `f(2)=2`.
- `equation.compiled.json`: exact solutions `2,3` of `x^2-5x+6=0`.
- `invalid-function.compiled.json`: candidate `x=0` locally satisfies `tan(x)=0`, while G13 correctly refuses to freeze its non-finite real solution set.

The P4 runner emitted the four required artifacts under `runs/p4/`:

- `gates.json`
- `function-vectors.json`
- `sampling-vectors.json`
- `sympy-oracle.json`

Final P4 evidence: **17/17 G13 oracle rows PASS** using SymPy 1.14.0; **12/12 G10 Node/Chrome frames PASS**, including RuntimeState and domain-snapshot digests. G9 repeats arbitrary `stateAt` samples 100×. The layout, compile-negative, curve sample, live assertion, and parameter-sweep checks all pass.

## Regression results

- `npx tsc --noEmit`: PASS.
- `npm test`: **145/145 tests PASS**.
- `npm run gates`: **P0, P1, P2, P3, P4 ALL GREEN**.
- P0: 20 valid and 24 invalid contract cases passed their expectations.
- P1: G9 and 7-frame G10 PASS.
- P2: G1–G11 and 9-frame G10 PASS.
- P3/P3.1: all gates PASS; P3.1 solver-only synthetic stationary tail remains outside `VerifiedMotionProgram.segments` and no Runtime/DomainAdapter architecture change was made.
- P4: G1/G2/G3/G6/G9 per fixture, G14 layout/semantic invariants/negative cases, 100× G9, freeze-required G13 and 12-frame G10 all PASS.

Chrome emitted an unrelated host-installed extension registry warning on stderr; it did not affect browser execution or any gate result.

## Runtime and artifact commands

```text
npm run build:player:p4
npm run gates:p4
npm test
npx tsc --noEmit
npm run gates
```

For a non-standard interpreter, set `MATHVIZ_PYTHON` to the Python executable containing pinned SymPy 1.14.0. Development-only SymPy/browser skips remain **INCOMPLETE**, never ALL GREEN.
