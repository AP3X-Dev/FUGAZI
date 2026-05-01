# ADR 009: Turborepo for build orchestration

## Status

Accepted

Date: 2026-04-30

## Context

With 11 packages plus editor and CI surfaces, running `tsc -b` per package serially is slow on a fresh checkout and wastes CPU on cached builds. We need:

1. A task graph that respects `tsconfig` project references (build dependencies before dependents).
2. Local caching of build, typecheck, lint, and test outputs so unchanged packages skip work entirely.
3. A way to run the same task across all packages with a single command (`turbo build`, `turbo test`, etc.).
4. Optional remote cache support for CI without forcing a vendor lock-in.

Candidates: Turborepo, Nx, Lerna, and a hand-rolled topological-sort wrapper around `tsc -b`. Lerna is in maintenance mode. Nx is feature-rich but its plugin model is heavier than we need. A hand-rolled wrapper would re-invent the cache layer.

## Decision

We use Turborepo with a single root `turbo.json` defining tasks for `build`, `typecheck`, `test`, `lint`, and `conformance`. Each task declares `inputs`, `outputs`, and `dependsOn` so the cache invalidation is precise. Turbo's local cache lives in `.turbo/` (gitignored) and keys on file content hashes plus the resolved task graph.

The cache is local-only by default. A remote cache (e.g., Vercel Remote Cache, or self-hosted via `turborepo-remote-cache`) is a CI-time optimization that is not required for correctness; we make it opt-in via environment variables and document the configuration but do not commit credentials.

Turbo's `--watch` mode is wired to `bun run dev:watch` for ergonomic iteration.

## Consequences

### Positive
- Cold-build of all 11 packages happens in parallel with proper dependency ordering. Warm builds are near-instant when nothing changed.
- A single `turbo build` (or `turbo test`, `turbo lint`) command runs the whole repo. Consistent across local dev and CI.
- The cache layer is well-tested and maintained; we don't carry that complexity ourselves.

### Negative
- Adds a development dependency that contributors have to learn (though `bun run build` hides Turbo behind the npm script).
- Turbo's daemon occasionally needs `turbo daemon clean` after upgrades. Documented in CONTRIBUTING.

### Neutral
- We pin a single Turbo version in `package.json` and bump it deliberately. No automatic minor-version drift.

## References

- PRP NFR-7
- Spec `§5.B`
- ADR-008 (workspaces)
