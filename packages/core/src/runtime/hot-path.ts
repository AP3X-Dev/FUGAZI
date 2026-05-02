/**
 * runtime/hot-path.ts — Phase 3g Wave A — `findHotPaths` detector core.
 *
 * Identifies the top-N% functions by aggregate hit count. The algorithm:
 *
 *   1. Aggregate per-function hits = Σ range.count over `functions[*].ranges`.
 *   2. Drop hits === 0 (those are cold, not hot).
 *   3. Drop the trivial-uniform case: if every executed function has the same
 *      hit count, no function is "hotter" than any other and the result is
 *      empty. This matches fixture (b) "uniform distribution → no hot path".
 *   4. Sort descending by hits; ties broken lex-asc by `(file, functionName)`.
 *   5. Cutoff index = `ceil(N * percentileThreshold/100)`. Functions with
 *      sort-rank `< cutoff` are flagged.
 *   6. `percentile` = `(rank / N) * 100`, where rank=0 is the absolute hottest.
 *
 * v1 limitation — line/col deferred to Wave B:
 *   The detector has no access to source text and therefore no `OffsetMap`,
 *   so `line` and `col` are emitted as `0`. Wave B's `runRuntime` orchestrator
 *   re-projects each finding through `buildOffsetMap(srcText)` before
 *   surfacing as a `HotPathIssue`.
 *
 * Determinism (NFR-1, SC-15): the sort is stable on a deterministic key, and
 * the result array is frozen.
 */

import type { CoverageIndex, FindHotPathsOptions, HotPathFinding } from './types.js';

const DEFAULT_PERCENTILE_THRESHOLD = 10;

interface RankedFn {
  readonly file: string;
  readonly functionName: string;
  readonly hits: number;
}

/**
 * Find the hot-path functions in `coverage` per the configured percentile.
 *
 * Functions are deduplicated by `byFunction` keys (which already account for
 * anonymous-function collisions via `::<i>` suffixing in `buildCoverageIndex`).
 * For ranking purposes the "function name" displayed in the finding is the
 * raw `functionName` from the coverage record, so a `<anonymous>::1` key still
 * surfaces as `<anonymous>` to the consumer — matching the original V8 view.
 */
export function findHotPaths(
  coverage: CoverageIndex,
  opts: FindHotPathsOptions = {},
): readonly HotPathFinding[] {
  const threshold = opts.percentileThreshold ?? DEFAULT_PERCENTILE_THRESHOLD;

  const ranked: RankedFn[] = [];
  for (const [path, fns] of coverage.byFile) {
    for (const fn of fns) {
      const hits = sumHits(fn.ranges);
      if (hits === 0) continue;
      ranked.push({ file: path, functionName: fn.functionName, hits });
    }
  }

  if (ranked.length === 0) return Object.freeze([] as readonly HotPathFinding[]);

  // Uniform distribution → no hot path. Compare against the first hits value;
  // if every entry matches, every function is equally hot, and none stands out.
  const firstHits = ranked[0]?.hits;
  if (firstHits !== undefined && ranked.every((r) => r.hits === firstHits)) {
    return Object.freeze([] as readonly HotPathFinding[]);
  }

  ranked.sort((a, b) => {
    if (a.hits !== b.hits) return b.hits - a.hits;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.functionName !== b.functionName) return a.functionName < b.functionName ? -1 : 1;
    return 0;
  });

  const total = ranked.length;
  const cutoff = Math.ceil((total * threshold) / 100);
  if (cutoff === 0) return Object.freeze([] as readonly HotPathFinding[]);

  const out: HotPathFinding[] = [];
  for (let rank = 0; rank < cutoff && rank < total; rank++) {
    const entry = ranked[rank];
    if (entry === undefined) continue;
    out.push({
      file: entry.file,
      functionName: entry.functionName,
      hits: entry.hits,
      percentile: (rank / total) * 100,
      line: 0,
      col: 0,
    });
  }
  return Object.freeze(out);
}

function sumHits(ranges: readonly { readonly count: number }[]): number {
  let total = 0;
  for (const r of ranges) total += r.count;
  return total;
}
