# P3 Motion1D Report

## Scope and architecture

P3 adds a second domain under `packages/domains/motion1d/` through the existing `DomainAdapter` interface. Runtime has no Motion1D conditional branch. The adapter compiles frozen Math IR once to a JSON-safe `VerifiedMotionProgram`, then evaluates arbitrary model time independently to a `MotionSnapshot`; snapshot-first binding feeds the unchanged generic Runtime state assembly. The SVG renderer receives only resolved bindings and presentation data.

The numeric kernel uses normalized bigint rational arithmetic. Canonical units are m, s, m/s; supported input units include m/km, s/min/h, and m/s/km/h. Thus `1 km/h` normalizes exactly to `5/18 m/s`. Body parameters are fact references with provenance, not duplicated into unprovenanced entity properties.

Segments are sorted by source order, strictly start-ordered, non-overlapping, contiguous, continuous, and teleport-free. They use `[start,end)` semantics. Bodies are inactive before their first segment; bounded final segments freeze at the final position after their end. Meeting, overtake, and reach events are solved over exact rational interval arithmetic. Overtake requires the first participant to start behind, equality, then pass; no reversal is rejected. Frozen `event.at` and derived facts are checked against the solver and mismatches fail with `E_MATH_ASSERTION`.

## Acceptance examples

- Pursuit: A speed 5 m/s, B begins at 10 s with 8 m/s (input `144/5 km/h`); exact overtake is `80/3 s` at `400/3 m`.
- Head-on meeting: 0 m at +5 m/s and 100 m at −5 m/s meet at 10 s, 50 m.
- Piecewise: 0–10 s at 5 m/s, 10–20 s at 8 m/s, 20–30 s stationary; the body reaches 130 m exactly at 20 s, and the final resting interval is covered by the reach event.

The interactive pursuit page uses the same fixture as the Node gates. The presentation mapping animates model time 0→80/3, then holds at the event. `number_line`, `moving_body`, and `marker` paint values already resolved upstream. A pure linear `scale` binding transform maps world distance to normalized presentation coordinate; unsupported transform kinds remain explicit errors.

## Verification

`tests/p3.test.ts` covers the three examples, exact unit conversion, event and derived-fact rejection, gaps/overlaps/no-overtake cases, arbitrary-time forward/reverse access, segment boundaries, generic Runtime and SVG integration. G12 invariant reports check exact positions, segment domains, and event equality. G9 repeats event/boundary anchors 100 times. G10 compares Node and Chrome digests at six frames.

P2.1 RuntimeState digests now include the complete DomainSnapshot digest when a provider runs. With no provider, the previous P1 digest payload is unchanged and frozen vectors are asserted. G10 can only report `ALL GREEN` when it actually passes. Without Chrome, freeze mode records `INCOMPLETE` and exits nonzero; `ALLOW_BROWSER_SKIP=1` is development-only, records `INCOMPLETE`, and cannot mask other failures.

Artifacts: `runs/p3/gates.json`, `runs/p3/motion-vectors.json`, `runs/p3/event-solutions.json` (generated, gitignored). Run `npm test`, `npx tsc --noEmit`, `npm run gates:p0` through `npm run gates:p3`.
