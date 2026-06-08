# ADR 001: No TypeScript-compiler dependency at runtime

## Status

Accepted

Date: 2026-04-30

Background: this ADR records Fugazi's decision to avoid a runtime dependency on the TypeScript compiler.

## Context

Fugazi is a static analyzer for TypeScript and JavaScript codebases. The temptation to depend on the TypeScript compiler (`tsc`) for symbol resolution, type-aware unused-export detection, and re-export propagation is real: `tsserver` already does much of this work, the API is well documented, and most contributors know it.

We reject that path for three reasons:

1. **Performance ceiling.** Loading `tsc`'s checker on a medium-sized monorepo costs seconds before we have done any of our own analysis. NFR targets demand sub-second cold-start on the same workloads. There is no engineering sleight-of-hand that closes that gap while still using the type checker.
2. **Determinism.** `tsc`'s output depends on `lib`, `target`, `moduleResolution`, the user's `tsconfig`, and the exact compiler version in their `node_modules`. Running Fugazi twice on the same source can produce different findings if any of those drift. Our determinism goal (byte-identical output across runs given identical source) is incompatible with this.
3. **Install footprint.** Pulling `typescript` as a runtime dependency adds ~70 MB to every install. Users who already have `typescript` in their workspace can deduplicate; users who don't pay the full price.

## Decision

Fugazi performs syntactic analysis only. We rely on a chosen WASM parser (oxc-parser-wasm primary, swc-wasm fallback) for the AST and implement everything else — symbol tables, re-export resolution, dead-code reachability, complexity, duplication — as plain TypeScript walking the AST. We do not link against `typescript`, do not load `tsserver`, and do not consume `.d.ts` files for type information.

When a check would benefit from type knowledge (e.g., distinguishing a type-only import from a value import), we use the syntactic markers the parser already exposes (`import type`, `export type`, etc.). When the syntactic information is insufficient, we err on the side of conservative detection rather than reach for the type checker.

## Consequences

### Positive
- Cold-start is bounded by parser load + file walk; targets in NFR-1..NFR-3 stay reachable.
- Output is fully reproducible from source plus configuration; no hidden dependence on user `tsconfig`.
- Install size stays small. Fugazi never forces TypeScript onto a project that doesn't already use it.

### Negative
- A small class of analyses that genuinely need types (e.g., "is this `unknown` cast actually unreachable?") cannot be implemented in v1. We ship without them rather than half-implement.
- Re-export chains involving complex generic forwarding can't always be resolved precisely. ADR-005 documents the fixed-point strategy and its known limits.

### Neutral
- Plugin authors who want type-aware rules can ship them as separate tools that consume Fugazi's output. We do not block that path; we just don't take the dependency ourselves.

## References

- Requirements: `H1`, NFR-1, NFR-3
- Spec `§4`, `§9`
- ADR-005 (re-export chain resolution)
