# ADR 014: Vitest with workspace projects; fast-check for property tests

## Status

Accepted

Date: 2026-04-30

## Context

The spec requires that the test suite produce identical results under both Bun and Node 22+ (`SC-30`). Two ways to read this:

1. Maintain two separate test suites: `node:test` for Node, `bun:test` for Bun. Run both in CI. Diverge by definition; converge by discipline.
2. Use a single test runner that runs cleanly on both runtimes and execute it twice in CI. One source, two runtimes.

Option 1 doubles the maintenance burden for a determinism win we can get from Option 2 with no extra cost. Vitest, as of 2026, runs natively on both Bun and Node and supports workspace projects (one config per package, picked up by a root `vitest.workspace.ts`).

For property-based tests (re-export propagation termination, FileId path-sort invariants, cycle detection), `fast-check` is the de-facto standard in the JS ecosystem and integrates cleanly with Vitest.

## Decision

We use Vitest as the only test runner. Each package has its own `vitest.config.ts` that re-exports a minimal config (`include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts']`, `passWithNoTests: true`). The root `vitest.workspace.ts` enumerates all 11 packages so `bun x vitest run` collects the whole repo in one pass.

CI runs `bun x vitest run` and `node --import @vitest/import-meta-resolve --import vitest/runner ...` (or the equivalent Node runner invocation) as separate jobs. The expectation is identical results.

Property tests are written with `fast-check`. The spec's `SC-30` and `§9.2` checklist (re-export termination, FileId determinism) are satisfied via property runs that exercise generated input shapes.

We do **not** maintain a separate `node:test` suite. The spec requirement is "tests produce identical results under both runtimes," and a single Vitest suite executed twice meets that bar without doubling maintenance.

## Consequences

### Positive
- One test source of truth. New tests don't need a "remember to add to both runners" checklist.
- Vitest's snapshot machinery is shared, so output-format byte-diff tests (FR-D3) write once, run twice.
- Property-based testing via fast-check finds edge cases hand-written tests miss; we use it for the highest-determinism-risk areas.

### Negative
- Vitest carries dependencies (esbuild, vite). Negligible for a dev dependency; we don't ship them with the published `fugazi` package.
- Bun-specific test features (e.g., `bun:test`'s built-in matchers) are unavailable. We don't miss them — Vitest's matchers cover everything we need.

### Neutral
- If a future Bun release breaks Vitest, the npm-only CI lane (ADR-008) keeps us building while we file a bug. We have not had to use this fallback to date.

## References

- Requirements: `SC-30`, FR-D3
- Spec `§3.E`, `§11.E`
- ADR-008 (workspaces)
