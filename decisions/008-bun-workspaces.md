# ADR 008: Use Bun workspaces (Node-compatible) as the workspace manager

## Status

Accepted

Date: 2026-04-30

## Context

Fugazi is a monorepo of 11 packages plus an editor extension and a couple of CI surfaces. The workspace manager has to handle hoisting, deduplication, and cross-package linking, and it has to do so on both `bun` (our preferred runtime) and `npm`/`pnpm` (because contributors and CI must not be Bun-locked).

The candidates were `bun workspaces`, `pnpm workspaces`, `npm workspaces`, and `yarn`. Decision criteria: install speed, lockfile determinism, cross-runtime compatibility, and ecosystem maturity at our target scale.

## Decision

We use `bun workspaces` as the primary workspace manager. The repo ships a `bun.lockb` (binary) lockfile committed to git. The root `package.json` declares `"workspaces": ["packages/*", "editors/*", ...]`.

We commit to Node compatibility: every script that Bun runs must also run on Node 22+. The CI matrix runs `npm install --workspaces && npm run build && npm test` on Node 22 LTS to enforce this. A second job runs the same scripts under Bun. Any divergence is a release blocker.

We do not use `pnpm`. An earlier draft of this decision left `pnpm` as the fallback if `bun install` ever produces a non-deterministic resolution graph. As of the date above, no such issue has been observed.

## Consequences

### Positive
- Install speed under Bun is the fastest available option in 2026 — order-of-magnitude faster than npm on cold cache.
- Single tool covers package install, script run, and (with Bun's built-ins) test execution. Reduces the matrix of "which CLI does what."
- Cross-package linking via `"workspace:*"` protocol matches the pnpm/yarn convention; tooling that reads `package.json` doesn't have to special-case Bun.

### Negative
- Bun's workspace implementation is younger than pnpm's. We mitigate via the npm-compatibility CI lane: if Bun ever produces a degenerate install, npm will still produce a working one and we have evidence for the bug report.
- The binary `bun.lockb` is opaque in code review. We accept this; lock-file diffs are rarely useful in review anyway, and the tool will print a text diff on demand.

### Neutral
- A `pnpm-workspace.yaml` is not committed but the migration path is documented if the override clause ever fires.

## References

- Requirements: `H1`
- Spec `§2.A`
- ADR-009 (Turbo orchestration on top of these workspaces)
