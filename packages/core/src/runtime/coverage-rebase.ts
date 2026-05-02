/**
 * runtime/coverage-rebase.ts — Phase 3g Wave B — auto-detection layer over the
 * v8-coverage explicit `rebaseCoverage`.
 *
 * Two modes:
 *
 *   - **explicit**: caller provides `{ from, to }`; we delegate straight to
 *     `rebaseCoverage({ fromPrefix: from, toPrefix: to })`. Same semantics
 *     (un-mapped entries flagged, console.warn), no ambiguity check.
 *   - **auto**: caller passes `'auto'`. We compute the longest common prefix of
 *     coverage URLs and the longest common prefix of project file paths, then
 *     propose `{ from: <coverage prefix>, to: <project prefix> }`. The mapping
 *     is validated by sampling: at least 50% of coverage URLs must rebase to a
 *     non-empty path under the proposed mapping. If validation fails — or if
 *     the coverage scripts split across multiple distinct prefixes — we throw
 *     `FugaziCoverageError(COVERAGE_REBASE_AMBIGUOUS)` with the verbatim
 *     message:
 *
 *       --coverage-root auto: cannot determine unambiguous mapping (matched <N> of <M> paths)
 *
 * Determinism (NFR-1): the longest-common-prefix walk is order-independent
 * relative to URL sets but the input arrays preserve insertion order, so the
 * returned `RebasedScript[]` matches the input ordering of `scripts`.
 */

import { FugaziCoverageError } from '@fugazi/types';
import { type RebasedScript, type ScriptCoverage, rebaseCoverage } from '@fugazi/v8-coverage';

export interface RebaseAutoExplicit {
  readonly from: string;
  readonly to: string;
}

export type RebaseMode = 'auto' | RebaseAutoExplicit;

export interface RebaseAutoOptions {
  readonly mode: RebaseMode;
  readonly projectRoot: string;
  readonly modules?: ReadonlySet<string>;
}

/** Match-rate cutoff for auto-detection success. */
const MIN_MATCH_RATIO = 0.5;

/**
 * Rebase `scripts` using the explicit-or-auto mode.
 */
export function rebaseCoverageAuto(
  scripts: readonly ScriptCoverage[],
  options: RebaseAutoOptions,
): readonly RebasedScript[] {
  const { mode } = options;
  if (mode !== 'auto') {
    return rebaseCoverage(scripts, { fromPrefix: mode.from, toPrefix: mode.to });
  }

  // No scripts → identity rebase. Nothing to detect; nothing to rebase.
  if (scripts.length === 0) return [];

  const coveragePrefix = longestCommonPrefix(scripts.map((s) => s.url));
  // Project prefix: prefer the explicit `projectRoot` (always rooted at the
  // workspace anchor) and only fall back to the LCP of module paths when no
  // root is supplied. Always trail with `/` so the rebase output sits on a
  // directory boundary.
  const projectPrefix = ensureTrailingSlash(
    options.projectRoot.length > 0
      ? options.projectRoot
      : longestCommonPrefix(options.modules !== undefined ? Array.from(options.modules) : []),
  );

  // Validate by sampling: how many scripts would rebase to a non-empty path
  // under the proposed mapping?
  let matched = 0;
  if (coveragePrefix.length > 0) {
    for (const s of scripts) {
      if (s.url.startsWith(coveragePrefix)) matched += 1;
    }
  }
  const ratio = matched / scripts.length;
  if (coveragePrefix.length === 0 || ratio < MIN_MATCH_RATIO) {
    throwAmbiguous(matched, scripts.length);
  }

  return rebaseCoverage(scripts, { fromPrefix: coveragePrefix, toPrefix: projectPrefix });
}

function throwAmbiguous(matched: number, total: number): never {
  throw new FugaziCoverageError({
    code: 'COVERAGE_REBASE_AMBIGUOUS',
    message: `--coverage-root auto: cannot determine unambiguous mapping (matched ${matched} of ${total} paths)`,
  });
}

/**
 * Longest common string prefix across `values`. Empty input or any empty
 * member shortens the prefix to `''`. Works on arbitrary strings — we trim to
 * the last `/` boundary so the prefix lines up with a directory boundary
 * rather than splitting a filename.
 */
function longestCommonPrefix(values: readonly string[]): string {
  if (values.length === 0) return '';
  const first = values[0] ?? '';
  if (values.length === 1) return trimToBoundary(first);
  let prefixLen = first.length;
  for (let i = 1; i < values.length; i++) {
    const next = values[i] ?? '';
    const limit = Math.min(prefixLen, next.length);
    let j = 0;
    while (j < limit && first.charCodeAt(j) === next.charCodeAt(j)) j += 1;
    prefixLen = j;
    if (prefixLen === 0) return '';
  }
  return trimToBoundary(first.slice(0, prefixLen));
}

function trimToBoundary(prefix: string): string {
  // Stop at the last `/` so the prefix represents a directory boundary.
  const lastSlash = prefix.lastIndexOf('/');
  if (lastSlash === -1) return prefix;
  return prefix.slice(0, lastSlash + 1);
}

function ensureTrailingSlash(p: string): string {
  if (p.length === 0) return p;
  return p.endsWith('/') ? p : `${p}/`;
}
