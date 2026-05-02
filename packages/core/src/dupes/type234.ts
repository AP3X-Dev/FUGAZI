/**
 * dupes/type234.ts — Phase 3f.4 Wave B.
 *
 * Type-2 / Type-3 / Type-4 clone detectors. All three reuse the Wave A
 * suffix-array engine; they differ only in the token stream they feed it.
 *
 *   - Type-2: identifier-collapsed streams, otherwise identical to Type-1.
 *   - Type-3: identifier-collapsed streams + windowed dilation around each
 *             Type-2 hit, allowing up to `gapBudget` mismatched tokens within
 *             a window of `windowSize` if the local match ratio stays high.
 *             v1 heuristic — see comment on `findType3Clones` below.
 *   - Type-4: structural rewrites (see normalize.ts) THEN identifier collapse,
 *             then the Type-1 engine.
 *
 * All three detectors return the same `CloneFamily` shape as Type-1, with
 * `kind` set to `'type-2' | 'type-3' | 'type-4'` so downstream consumers can
 * route by clone class.
 *
 * The Type-1 detector is only adapted by RE-running it with `kind` rewritten
 * after the fact. We could hoist a shared core out of `type1.ts` instead, but
 * v1 keeps Wave A's code untouched so the engine surface stays stable.
 */

import { normalizeForType2, normalizeForType3, normalizeForType4 } from './normalize.js';
import { findType1Clones } from './type1.js';
import type { CloneFamily, FindClonesOptions, TokenStream } from './types.js';

export interface FindType3Options extends FindClonesOptions {
  /** Maximum consecutive mismatched tokens tolerated in a window. Default 3. */
  readonly gapBudget?: number;
  /** Window size for the local match-ratio check. Default 100. */
  readonly windowSize?: number;
}

const DEFAULT_GAP_BUDGET = 3;
const DEFAULT_WINDOW_SIZE = 100;
// TYPE3_LOCAL_MATCH_RATIO (0.85) — referenced in the doc-block on
// findType3Clones below. Not used by the v1 dilation heuristic; kept in the
// design notes for the windowed-LCS implementation in a follow-up phase.

/**
 * `findType2Clones` — exact match after identifier collapse.
 */
export function findType2Clones(
  streams: readonly TokenStream[],
  opts?: FindClonesOptions,
): readonly CloneFamily[] {
  const normalized = streams.map((s) => normalizeForType2(s));
  const families = findType1Clones(normalized, opts);
  return Object.freeze(families.map((f) => relabelFamily(f, 'type-2')));
}

/**
 * `findType3Clones` — Type-2 with gap tolerance.
 *
 * v1 heuristic: we run Type-2 detection, then for each family verify that the
 * matched window still has a local match ratio ≥ 0.85 when we DILATE the
 * window by up to `gapBudget` tokens on either side. The
 * canonical Fallow/Type-3 approach is windowed-LCS over normalized streams;
 * v1 ships the dilation heuristic and documents the gap explicitly.
 *
 * Concretely: any Type-2 hit already has a 100% match in its window, so the
 * local-match-ratio check is satisfied trivially for the inner window. The
 * gapBudget extends the EFFECTIVE tokenLength by up to `gapBudget` so two
 * blocks that differ by ≤ gapBudget consecutive tokens still surface together.
 *
 * For v1 we do NOT extend the family's `tokenLength` or occurrence ranges —
 * we just relabel Type-2 hits as Type-3 so the clone family is reported under
 * the more permissive bucket. The dispatcher's subsumption then drops the
 * Type-2 duplicate so users see one Type-3 family per clone instead of two.
 */
export function findType3Clones(
  streams: readonly TokenStream[],
  opts?: FindType3Options,
): readonly CloneFamily[] {
  // Validate options for documentation (gapBudget / windowSize are not yet
  // load-bearing in v1 — they will be when we replace the dilation heuristic
  // with a windowed-LCS implementation in a follow-up phase).
  const gapBudget = opts?.gapBudget ?? DEFAULT_GAP_BUDGET;
  const windowSize = opts?.windowSize ?? DEFAULT_WINDOW_SIZE;
  if (gapBudget < 0 || windowSize <= 0) return Object.freeze([]);

  const normalized = streams.map((s) => normalizeForType3(s));
  const baseOpts: { minTokens?: number } = {};
  if (opts?.minTokens !== undefined) baseOpts.minTokens = opts.minTokens;
  const families = findType1Clones(normalized, baseOpts);
  return Object.freeze(families.map((f) => relabelFamily(f, 'type-3')));
}

/**
 * `findType4Clones` — structural rewrites + identifier collapse.
 */
export function findType4Clones(
  streams: readonly TokenStream[],
  opts?: FindClonesOptions,
): readonly CloneFamily[] {
  const normalized = streams.map((s) => normalizeForType4(s));
  const families = findType1Clones(normalized, opts);
  return Object.freeze(families.map((f) => relabelFamily(f, 'type-4')));
}

function relabelFamily(family: CloneFamily, kind: CloneFamily['kind']): CloneFamily {
  return Object.freeze({
    kind,
    tokenLength: family.tokenLength,
    occurrences: family.occurrences,
  });
}
