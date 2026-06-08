# ADR 003: Native `Map`/`Set` with insertion-order discipline

## Status

Accepted

Date: 2026-04-30

We need associative data structures that are both fast and reproducible. We achieve that property by leaning on a guarantee V8 already gives us.

## Context

Dead-code analysis, duplicate detection, and re-export propagation all rely on associative data structures. Two properties matter:

1. **Determinism.** Two runs of the analyzer over the same input must produce byte-identical output. If iteration over a hashmap shuffles based on hash seed, findings may shuffle, and output drift becomes a CI flake.
2. **Speed.** These maps are touched in inner loops; a per-insert cost difference of 10ns compounds to seconds on large graphs.

A deterministically-seeded hash table is one way to satisfy both, but the TS/Node runtime gives us simpler primitives that already meet our needs.

## Decision

We use the built-in `Map` and `Set`. ECMAScript guarantees iteration order matches insertion order, and V8's implementation is fast enough that we have no measured cause to reach for a custom hash table.

The discipline that makes this deterministic across the whole pipeline:

1. **Insert in a deterministic order.** Inputs to any `Map`/`Set` derive from already-sorted sources (FileIds per ADR-004, symbol names sorted lexicographically before insert).
2. **Sort on emit.** Any output path — JSON reporter, SARIF reporter, snapshot test, anything that crosses a process boundary — calls `.sort()` explicitly with a stable comparator before writing.
3. **No `Object` as a map.** Object property iteration order is *mostly* deterministic on modern engines but mixes integer-like and string keys in surprising ways. We always use `Map`.

Sets that participate in cycle detection use the same discipline. `WeakMap`/`WeakSet` are reserved for caches whose iteration we never observe.

## Consequences

### Positive
- Zero-dependency: nothing to install, nothing to load.
- Engine-optimized: V8 has spent more effort on `Map` than any third-party hash table available to us.
- Reproducible iteration without a custom seed mechanism.

### Negative
- Programmer must remember to sort on emit. We address this with a CI byte-diff gate (see PRP `SC-29`) that runs the analyzer twice on the same input and diffs output. Forgotten sorts surface immediately.

### Neutral
- A future regression where we need a faster map (suffix-array internals, for example) is permitted; this ADR governs the default, not a hard ban. Such a regression must come with its own ADR justifying the swap.

## References

- PRP NFR-2, FR-D3, SC-29
- Spec `§3`, `§9`
- ADR-004 (path-sorted FileIds)
