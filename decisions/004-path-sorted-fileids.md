# ADR 004: Path-sorted, deterministic FileId assignment

## Status

Accepted

Date: 2026-04-30

Background / prior art: carry-forward from the original Fallow project's "path-sorted-fileids" ADR. The strategy is identical because the determinism rationale is identical. The TS port packages it as a branded number type rather than a Rust newtype, but the behavior is the same.

## Context

Every file in a project is assigned a numeric `FileId`. This number flows through the module graph, the dead-code reachability bitset, the cache layer, and (redacted from output) into snapshot tests. If `FileId` assignment is not deterministic across runs, every downstream artifact drifts even when the source code didn't change.

Two non-deterministic strategies were considered and rejected:

1. **Discovery-order.** Assign IDs in the order files appear during the directory walk. Fails because directory iteration order is filesystem-dependent (different on macOS/Linux/Windows, different on case-insensitive filesystems, different across `bun` and `node` for `Bun.glob` vs `fast-glob`).
2. **Hash of path.** Assign `FileId = hash(absolute_path)`. Fails for cache-locality reasons (random access patterns) and forces wider integer types.

## Decision

After file discovery completes, we sort the discovered absolute paths lexicographically and assign `FileId(i)` to the path at index `i`. The sort is byte-wise on the canonical absolute path (forward slashes, lowercase drive letter on Windows, NFC-normalized).

`FileId(0)` is reserved as a sentinel — `ROOT_FILE_ID` — to represent "external / not-a-file" edges (e.g., `node_modules` resolutions that fall back to a package root). Real files are assigned `FileId(1..N)` after `ROOT_FILE_ID`.

The branded type is `type FileId = number & { readonly __brand: 'FileId' }`. Construction goes through a single factory in `@fugazi/types` that asserts the integer is non-negative.

## Consequences

### Positive
- Two runs of the analyzer on the same source produce identical FileIds, identical edges, identical dead-code bitsets, identical output.
- Cache layer keys can use `FileId` directly without indirection; cache hits across runs work because the IDs are stable.
- Cross-platform identical: a developer on Windows and a developer on Linux see the same FileId for the same path (because we canonicalize paths and sort byte-wise on the canonical form).

### Negative
- Adding a new file requires re-sorting and re-assigning all subsequent FileIds. Incremental analysis must therefore key cache entries on canonical path, not on raw FileId. We accept this cost.
- The sort step itself is O(n log n) on file count. Negligible at the scales we target (≤200k files).

### Neutral
- The single sentinel `ROOT_FILE_ID = 0` is a small footgun if a contributor uses `FileId(0)` as "first file". We mitigate with a comment on the constructor and a runtime assertion in dev builds.

## References

- PRP NFR-2, FR-D3, FR-G2
- Spec `§5`, `§9`
- ADR-002 (edge storage)
- ADR-003 (Map/Set discipline)
