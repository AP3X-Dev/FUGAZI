# ADR 005: Re-export chain resolution via fixed-point iteration with cycle cap

## Status

Accepted

Date: 2026-04-30

Background / prior art: this ADR documents Fugazi's re-export-chain-resolution approach. The algorithm and the iteration cap are paired with warning machinery built on `FugaziGraphError` and the per-process warn-once dedup convention.

## Context

Real codebases stack barrels. `packages/foo/index.ts` re-exports from `./submodule`, which re-exports from `../shared`, which re-exports from a fourth file. To answer "is `bar` from `packages/foo` actually used?" we have to walk the chain back to the original declaration.

Two complications:

1. **Cycles.** `a.ts` re-exports `*` from `b.ts`; `b.ts` re-exports `*` from `a.ts`. Most TypeScript projects don't do this on purpose, but barrel-heavy codebases create cycles by accident, and the analyzer must terminate.
2. **Wildcard re-exports.** `export * from './shared'` propagates *all* of `shared`'s exports. If the propagation requires another iteration to converge (because `shared` itself has a wildcard re-export), we're doing a fixed-point computation, not a single graph walk.

## Decision

Re-export resolution runs as a fixed-point loop:

1. Build the initial table of `{ module → exported symbols }` from direct exports only.
2. Repeatedly walk re-export edges, expanding wildcards and named re-exports, until no new symbols appear in any module's table — i.e., the fixed point is reached.
3. Cap the loop at `max_iterations = 20`. This is empirically more than enough for legitimate codebases (the deepest barrel chains we have seen in 145 fixtures top out at 7 levels; 20 leaves headroom).
4. If the cap is hit before convergence, emit a `FugaziGraphError` warning with code `REEXPORT_FIXEDPOINT_CAP` carrying the module IDs that were still changing at iteration 20. This warning is informational; analysis continues with whatever the table was at the cap. Per-process warn-once dedup keyed by message + module path prevents log spam.

Cycle detection is implicit: once the fixed point is reached (or the cap is hit), every cycle has been visited a bounded number of times. Synthetic placeholder symbols are not introduced; we instead treat unresolved re-exports as conservative "unknown" markers so dead-code analysis stays sound (false negatives, not false positives).

## Consequences

### Positive
- Termination is guaranteed by the iteration cap, regardless of input pathology.
- The cap is high enough that no real codebase we have measured hits it.
- Hitting the cap surfaces a clear, machine-readable warning with the offending modules — diagnostics, not silent corruption.

### Negative
- Pathological inputs (deliberate 30-deep barrel chains) produce conservative-but-incomplete results. Acceptable: we'd rather fail visibly with a warning than spend unbounded time.
- Plugin authors writing custom rules that depend on re-export resolution must understand the "unknown" marker semantics. Documented in `docs/plugin-authoring.md`.

### Neutral
- The cap of 20 is tunable through `fugazi.config` if a future workload needs it; we document the tuning knob without committing to long-term support of arbitrary values.

## References

- PRP FR-G2, NFR-3
- Spec `§5`, `§9.2`
- ADR-002 (edge storage), ADR-003 (Map discipline)
