# ADR 002: Module-graph edges stored as pre-built reverse indices

## Status

Accepted

Date: 2026-04-30

Background / prior art: carry-forward from the original Fallow project's "flat-edge-storage" ADR. The TS port preserves the data-shape rationale; the in-memory representation differs to suit V8.

## Context

The module graph is consulted heavily during analysis: dead-code BFS walks reachability, unused-exports needs every consumer of every symbol, and cross-reference reporting answers "who imports this file?" thousands of times. Naive representations make those queries slow.

Two patterns are tempting and wrong:

1. **Per-query traversal.** Walk the forward edges every time a "who imports X?" question is asked. Wastes work proportional to graph size on every query.
2. **Hash-keyed adjacency lists with arbitrary iteration order.** Fast for queries but produces non-deterministic findings when iteration order leaks into output (and it always does, eventually).

The Rust original solved this with flat `Vec<Edge>` arrays plus `Range<usize>` slices into them. JavaScript engines don't give us the same memory layout, but the strategy translates: build all the indices once, up front, and consult them by lookup.

## Decision

Graph state holds two parallel structures, both built once during graph construction and never mutated afterwards:

- `edges_by_source` — for each source `FileId`, the list of imports it makes (forward edges).
- `edges_by_target` — for each target `FileId`, the list of files importing it (reverse edges).

Both use `Map<FileId, Edge[]>` keyed numerically; the inner arrays are sorted by FileId to preserve determinism. Edges themselves are plain objects with `{ source, target, symbols }`.

Analysis passes consume these read-only. Adding an edge after graph construction is a programmer error and throws `FugaziGraphError` with code `GRAPH_FROZEN`.

## Consequences

### Positive
- Reverse-edge queries (used in dead-code, cross-reference, and the LSP "find references" code lens) are O(1) lookups.
- Iteration order is fully determined by FileId, which is itself path-sorted (ADR-004). Output is reproducible.
- The graph object is shareable across worker boundaries without further serialization concerns since it is structurally identical to a transferable plain object.

### Negative
- Memory cost is roughly 2x what a forward-only adjacency list would use. Acceptable: graphs at the scale we target (≤200k files) fit in tens of MB.
- Constructing both indices doubles graph-build time relative to forward-only. Measured cost is sub-100ms even on the largest fixture we test.

### Neutral
- Plugin authors who walk the graph see two indices instead of one. Documented in `docs/plugin-authoring.md`.

## References

- PRP NFR-2, FR-G3
- Spec `§5`
- ADR-004 (path-sorted FileIds)
