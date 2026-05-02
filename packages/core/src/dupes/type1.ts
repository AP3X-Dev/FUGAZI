/**
 * dupes/type1.ts — Phase 3f.4 Wave A.
 *
 * Type-1 (exact-match) clone detection. The algorithm:
 *
 *   1. Build a suffix array over the comment-free token streams.
 *   2. Walk the LCP array. Maximal runs of LCP[i] ≥ minTokens form a
 *      candidate clone family — all the suffix entries inside that run
 *      share a prefix of at least `minTokens` tokens.
 *   3. For each run, dedupe overlapping intra-file occurrences (a 100-token
 *      window starting at index 5 and one starting at index 6 in the same
 *      file are not interesting clones — they're the same code shifted by
 *      one token).
 *   4. Materialize byte ranges from the original `TokenStream`s and emit a
 *      `CloneFamily` per surviving run.
 *
 * Determinism is enforced at every level:
 *
 *   - Inside a family, occurrences sort by (file path asc, tokenStart asc).
 *   - Families sort by (-tokenLength, first-occurrence-key asc), where
 *     first-occurrence-key is the "smallest occurrence" of that family.
 *
 * v1 limitations (documented in dupes/types.ts):
 *
 *   - No "longest-match-wins" deduplication: a 100-token clone that contains
 *     a 90-token sub-clone will produce both families. Wave B may add a
 *     subsumption filter.
 *   - Cross-file matching is the common case but same-file matching is also
 *     supported (a single file with two copies of a block produces a family
 *     whose two occurrences both live in that file).
 */

import { buildSuffixArray } from './suffix-array.js';
import type { CloneFamily, CloneOccurrence, FindClonesOptions, TokenStream } from './types.js';

const DEFAULT_MIN_TOKENS = 50;

/**
 * `findType1Clones` — entry point. Pure function: same input → byte-equal
 * output. Returns a frozen array of frozen families.
 */
export function findType1Clones(
  streams: readonly TokenStream[],
  opts?: FindClonesOptions,
): readonly CloneFamily[] {
  const minTokens = opts?.minTokens ?? DEFAULT_MIN_TOKENS;
  if (streams.length === 0 || minTokens <= 0) return Object.freeze([]);

  const sa = buildSuffixArray(streams);
  const { suffixArray, lcp, fileForToken, fileBoundary } = sa;
  const n = suffixArray.length;
  if (n === 0) return Object.freeze([]);

  const families: CloneFamily[] = [];

  // Walk LCP runs. A run is a maximal contiguous range [l, r] such that
  // lcp[l+1..r] are all ≥ minTokens. The clone length for the run is the
  // *minimum* LCP in [l+1..r] — that's the longest common prefix shared by
  // ALL suffixes in the run.
  let i = 1;
  while (i < n) {
    if ((lcp[i] ?? 0) < minTokens) {
      i++;
      continue;
    }
    // Find the maximal run [start, end] (inclusive of suffix indices).
    const runStart = i - 1;
    let runEnd = i;
    let runMinLcp = lcp[i] ?? 0;
    while (runEnd + 1 < n && (lcp[runEnd + 1] ?? 0) >= minTokens) {
      runEnd++;
      const v = lcp[runEnd] ?? 0;
      if (v < runMinLcp) runMinLcp = v;
    }
    // runMinLcp is the longest length common to ALL members of the run.
    // Build occurrences from sa[runStart..runEnd].
    const tokenLength = runMinLcp;
    const rawOccurrences: { file: string; tokenStart: number; globalStart: number }[] = [];
    for (let k = runStart; k <= runEnd; k++) {
      const globalStart = suffixArray[k];
      if (globalStart === undefined) continue;
      const fileIdx = fileForToken[globalStart];
      if (fileIdx === undefined) continue;
      const fileBoundaryStart = fileBoundary[fileIdx] ?? 0;
      const tokenStart = globalStart - fileBoundaryStart;
      const stream = streams[fileIdx];
      if (stream === undefined) continue;
      // A suffix that starts on the sentinel is meaningless — skip. Sentinels
      // appear at globalStart === fileBoundaryStart + stream.tokens.length
      // (the position immediately after each file's last real token, except
      // the last file which has no trailing sentinel).
      if (tokenStart >= stream.tokens.length) continue;
      // Also: ensure the matched window doesn't run past the file's end. If
      // the prefix-doubling encoded a sentinel at the boundary, the equality
      // check naturally stops there — but the `tokenLength` from runMinLcp
      // assumes all members share that many tokens. If an occurrence's file
      // ends sooner than `tokenStart + tokenLength`, the run wouldn't have
      // included it (sentinel breaks LCP). Defense in depth — skip the rare
      // edge where a numeric off-by-one survives.
      if (tokenStart + tokenLength > stream.tokens.length) continue;
      rawOccurrences.push({ file: stream.file, tokenStart, globalStart });
    }

    if (rawOccurrences.length >= 2) {
      // Drop self-overlapping occurrences within the same file. Sort by
      // (file, tokenStart) first, then sweep.
      rawOccurrences.sort((a, b) => {
        if (a.file < b.file) return -1;
        if (a.file > b.file) return 1;
        return a.tokenStart - b.tokenStart;
      });

      const filtered: typeof rawOccurrences = [];
      for (const occ of rawOccurrences) {
        const last = filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
        if (
          last !== undefined &&
          last.file === occ.file &&
          occ.tokenStart < last.tokenStart + tokenLength
        ) {
          // Overlapping with previous in same file — skip.
          continue;
        }
        filtered.push(occ);
      }

      if (filtered.length >= 2) {
        const occurrences: CloneOccurrence[] = [];
        for (const occ of filtered) {
          // Need to find the right TokenStream by file path (we stored the
          // file string, not index — but multiple files could share a path
          // only if the caller mis-uses the API; here each file path maps to
          // one stream).
          const stream = findStream(streams, occ.file);
          if (stream === undefined) continue;
          const startTok = stream.tokens[occ.tokenStart];
          const endTok = stream.tokens[occ.tokenStart + tokenLength - 1];
          if (startTok === undefined || endTok === undefined) continue;
          occurrences.push(
            Object.freeze({
              file: occ.file,
              tokenStart: occ.tokenStart,
              tokenEnd: occ.tokenStart + tokenLength,
              byteRange: Object.freeze({
                start: startTok.byteOffset,
                end: endTok.byteOffset + endTok.byteLength,
              }),
            }),
          );
        }
        if (occurrences.length >= 2) {
          families.push(
            Object.freeze({
              kind: 'type-1',
              tokenLength,
              occurrences: Object.freeze(occurrences),
            }),
          );
        }
      }
    }

    i = runEnd + 1;
  }

  // Sort families: longest tokenLength first, tie-break by smallest first
  // occurrence's (file, tokenStart).
  families.sort((a, b) => {
    if (a.tokenLength !== b.tokenLength) return b.tokenLength - a.tokenLength;
    const fa = a.occurrences[0];
    const fb = b.occurrences[0];
    if (fa === undefined || fb === undefined) return 0;
    if (fa.file < fb.file) return -1;
    if (fa.file > fb.file) return 1;
    return fa.tokenStart - fb.tokenStart;
  });

  return Object.freeze(families);
}

function findStream(streams: readonly TokenStream[], file: string): TokenStream | undefined {
  for (const s of streams) {
    if (s.file === file) return s;
  }
  return undefined;
}

export type { CloneFamily, CloneOccurrence } from './types.js';
