/**
 * runtime/types.ts — Phase 3g Wave A — internal shapes for the
 * runtime-intelligence layer.
 *
 * Wave A ships standalone detector cores that consume an indexed view of V8
 * coverage and emit `*Finding` records. Wave B owns translation of these
 * findings into `HotPathIssue` / `ColdCodeIssue` (with line/col converted from
 * byte offsets via the source-text-aware `OffsetMap`). The detectors in Wave A
 * run before any source text is loaded, so they emit `line: 0, col: 0` and
 * leave conversion to the orchestrator.
 *
 * Determinism (NFR-1, SC-15): every detector returns a `readonly` array sorted
 * by stable, content-derived keys. Indexed views are `ReadonlyMap`s built in
 * insertion order matching the input ScriptCoverage iteration order.
 */

import type { FunctionCoverage } from '@fugazi/v8-coverage';

/** Per-function coverage indexed by absolute POSIX path. */
export type CoverageByFile = ReadonlyMap<string, readonly FunctionCoverage[]>;

/** Per-function coverage indexed by `${path}::${functionName}` for fast lookup. */
export type CoverageByFunction = ReadonlyMap<string, FunctionCoverage>;

/**
 * Two views over the same coverage payload. Both views are populated by
 * `buildCoverageIndex`; the result is shared (frozen) across detectors.
 */
export interface CoverageIndex {
  readonly byFile: CoverageByFile;
  readonly byFunction: CoverageByFunction;
}

/**
 * A single hot-path detection. `percentile` is the position in the
 * descending-by-hits ordering, normalized to 0..100 — rank=0 (the absolute
 * hottest function) maps to `0`, the median to `~50`, the coldest to
 * `~(N-1)/N * 100`. Lower percentile == hotter.
 *
 * `line` / `col` are emitted as `0` in Wave A; Wave B's orchestrator converts
 * the byte-offset of the function's first range via `buildOffsetMap`.
 */
export interface HotPathFinding {
  readonly file: string;
  readonly functionName: string;
  readonly hits: number;
  readonly percentile: number;
  readonly line: number;
  readonly col: number;
}

/**
 * A single cold-code detection. `hits` is the aggregate function count and is
 * always `<= hitThreshold` (default `0`). `line`/`col` deferred to Wave B.
 */
export interface ColdCodeFinding {
  readonly file: string;
  readonly functionName: string;
  readonly hits: number;
  readonly line: number;
  readonly col: number;
}

/** Tunables for `findHotPaths`. */
export interface FindHotPathsOptions {
  /** 0..100 — top N% of functions are flagged hot. Default `10`. */
  readonly percentileThreshold?: number;
}

/** Tunables for `findColdCode`. */
export interface FindColdCodeOptions {
  /** Strict cold cutoff. Default `0` — only never-executed functions. */
  readonly hitThreshold?: number;
  /** `${file}::${functionName}` keys to skip. Built by Wave B from suppression directives. */
  readonly suppressedFunctions?: ReadonlySet<string>;
}
