/**
 * dupes/suffix-array.ts — Phase 3f.4 Wave A.
 *
 * Suffix-array + LCP construction over a u32-encoded global token stream.
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ Encoding pipeline                                                    │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  TokenStream[]  ─dictionary─►  Uint32Array (sentinel-separated)      │
 *   │       ─prefix-doubling─►  Uint32Array (suffix array)                 │
 *   │       ─Kasai─►            Uint32Array (LCP)                          │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Sentinel: id 0 is reserved as a per-file separator. Real tokens get ids
 * starting at 1. Each file's tokens are concatenated into the global stream
 * with one sentinel inserted *between* every adjacent pair (so n files
 * produce n-1 sentinels). This guarantees that any LCP run spanning a
 * sentinel is naturally bounded by 0 — sentinels are unique within the
 * stream because we encode them with a *fresh* id per occurrence (id 0
 * conceptually, but we materialize each as a unique negative-style marker:
 * we use a counter starting at 0 and just ensure each sentinel id is
 * distinct from every real token id and from every other sentinel).
 *
 * Concretely: real-token id space starts at N (N = sentinel count); sentinels
 * occupy ids 0..N-1. After both blocks are materialized into Uint32Array,
 * sorting is a plain integer compare. Each sentinel id is unique, so any
 * suffix that *starts* at a sentinel sorts uniquely; any suffix that *spans*
 * a sentinel from a real-token start also gets a 0-LCP at the sentinel
 * boundary because the sentinel id at that position differs from the real
 * token id at the corresponding position in the other suffix.
 *
 * Algorithm: prefix-doubling SA construction. At iteration k, suffixes are
 * sorted by their first 2^k characters. Each iteration:
 *
 *   1. Pair each suffix's current rank with its rank shifted by 2^(k-1).
 *   2. Sort suffixes by (rank, shifted-rank).
 *   3. Re-rank: equal pairs share a rank; distinct pairs get incremented.
 *
 * Stops when all ranks are distinct (n distinct ranks => sorted). Worst case
 * is O(n log² n) with a comparison sort; we use radix-style integer sort by
 * leveraging Uint32Array indices and pair encoding.
 *
 * LCP via Kasai (O(n)) — standard.
 */

import type { SuffixArrayResult, TokenStream } from './types.js';

export type { SuffixArrayResult } from './types.js';

/**
 * `buildSuffixArray` — main entry. Materializes the dictionary, encodes the
 * global stream as a `Uint32Array`, and runs prefix-doubling SA + Kasai LCP.
 *
 * Empty inputs (no streams, all-empty streams) return zero-length arrays.
 * `fileBoundary` always has length === streams.length even when a file is
 * empty (boundary points to where the empty file's tokens *would* start).
 */
export function buildSuffixArray(streams: readonly TokenStream[]): SuffixArrayResult {
  const sentinelCount = Math.max(0, streams.length - 1);

  // 1. Compute total length and per-file boundaries.
  const fileBoundary = new Uint32Array(streams.length);
  let totalRealTokens = 0;
  for (let f = 0; f < streams.length; f++) {
    const stream = streams[f];
    fileBoundary[f] = totalRealTokens + (f > 0 ? f : 0);
    if (stream !== undefined) totalRealTokens += stream.tokens.length;
  }
  const total = totalRealTokens + sentinelCount;

  // 2. Build dictionary: assign id ≥ sentinelCount to each unique token. Map
  //    is order-preserving; we materialize it as Uint32Array after the pass.
  const dict = new Map<string, number>();
  let nextId = sentinelCount;

  // 3. Materialize the global token stream. Sentinel id for boundary k
  //    (between file k and file k+1) is just `k` (so 0..sentinelCount-1).
  const tokens = new Uint32Array(total);
  const fileForToken = new Uint32Array(total);
  let g = 0;
  for (let f = 0; f < streams.length; f++) {
    const stream = streams[f];
    if (stream !== undefined) {
      for (const tok of stream.tokens) {
        const key = `${tok.kind}\x00${tok.value}`;
        let id = dict.get(key);
        if (id === undefined) {
          id = nextId++;
          dict.set(key, id);
        }
        tokens[g] = id;
        fileForToken[g] = f;
        g++;
      }
    }
    if (f < streams.length - 1) {
      // sentinel between file f and file f+1
      tokens[g] = f; // unique per boundary, < sentinelCount, < every real id
      fileForToken[g] = f;
      g++;
    }
  }

  // 4. Build suffix array via prefix-doubling.
  const suffixArray = buildSAPrefixDoubling(tokens);

  // 5. Build LCP via Kasai.
  const lcp = computeLCP(tokens, suffixArray);

  return {
    tokens,
    suffixArray,
    lcp,
    fileBoundary,
    fileForToken,
  };
}

/**
 * Prefix-doubling suffix-array construction. Runs in O(n log n) time with
 * O(n) extra Uint32Array space. Stable across runs (deterministic):
 * sort uses a Schwartzian-transform on (rank, nextRank, originalIndex) tuples
 * encoded as BigInt-free pair keys.
 */
function buildSAPrefixDoubling(text: Uint32Array): Uint32Array {
  const n = text.length;
  const sa = new Uint32Array(n);
  if (n === 0) return sa;
  if (n === 1) {
    sa[0] = 0;
    return sa;
  }

  // Initial: sa[i] = i, then sort by text[i].
  for (let i = 0; i < n; i++) sa[i] = i;
  sa.sort((a, b) => {
    const ta = text[a] ?? 0;
    const tb = text[b] ?? 0;
    return ta - tb;
  });

  // Initial rank: rank[i] = rank of suffix i after sorting by 1 char.
  const rank = new Uint32Array(n);
  {
    let r = 0;
    const first = sa[0];
    if (first !== undefined) rank[first] = 0;
    for (let i = 1; i < n; i++) {
      const cur = sa[i];
      const prev = sa[i - 1];
      if (cur === undefined || prev === undefined) continue;
      if ((text[cur] ?? 0) !== (text[prev] ?? 0)) r++;
      rank[cur] = r;
    }
  }

  // Iterate doubling k = 1, 2, 4, ... until ranks are all distinct.
  const tmpRank = new Uint32Array(n);
  for (let k = 1; k < n; k *= 2) {
    // Sort sa by (rank[i], rank[i+k] || 0). We use a JS Array for the sort
    // because Uint32Array.sort with a comparator works but costs predictable
    // O(n log n) integer compares. Encode the pair into a Number that fits in
    // 53 bits — n ≤ 2^26 keeps (rank * (n+1) + rank2) inside safe integer range.
    const pair = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r1 = rank[i] ?? 0;
      const r2 = i + k < n ? (rank[i + k] ?? 0) + 1 : 0; // +1 so 0 is reserved for "out of range"
      pair[i] = r1 * (n + 2) + r2;
    }

    sa.sort((a, b) => {
      const pa = pair[a] ?? 0;
      const pb = pair[b] ?? 0;
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      return a - b; // tie-break by index for stability
    });

    // Re-rank using sorted sa + pair[].
    let r = 0;
    const first = sa[0];
    if (first !== undefined) tmpRank[first] = 0;
    let allDistinct = true;
    for (let i = 1; i < n; i++) {
      const cur = sa[i];
      const prev = sa[i - 1];
      if (cur === undefined || prev === undefined) continue;
      const pa = pair[prev] ?? 0;
      const pb = pair[cur] ?? 0;
      if (pa !== pb) {
        r++;
      } else {
        allDistinct = false;
      }
      tmpRank[cur] = r;
    }
    rank.set(tmpRank);

    if (allDistinct) break;
  }

  return sa;
}

/**
 * Kasai's algorithm for LCP. Given the text and its suffix array, computes
 * `lcp[i]` = length of the longest common prefix between `suffixArray[i]`
 * and `suffixArray[i-1]`. `lcp[0]` is always 0 by convention.
 */
export function computeLCP(tokens: Uint32Array, suffixArray: Uint32Array): Uint32Array {
  const n = tokens.length;
  const lcp = new Uint32Array(n);
  if (n === 0) return lcp;

  // inv[suffixArray[i]] = i — the rank of suffix `i` in the sorted order.
  const inv = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const sai = suffixArray[i];
    if (sai !== undefined) inv[sai] = i;
  }

  let h = 0;
  for (let i = 0; i < n; i++) {
    const rk = inv[i];
    if (rk === undefined || rk === 0) {
      h = 0;
      continue;
    }
    const j = suffixArray[rk - 1];
    if (j === undefined) {
      h = 0;
      continue;
    }
    while (i + h < n && j + h < n && tokens[i + h] === tokens[j + h]) {
      h++;
    }
    lcp[rk] = h;
    if (h > 0) h--;
  }

  return lcp;
}
