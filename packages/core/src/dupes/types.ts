/**
 * dupes/types.ts — Phase 3f.4 Wave A.
 *
 * Internal types for the duplicate-detection engine. Wave A covers Type-1
 * (exact-token) clones; Wave B layers Type-2/3/4 normalization on top of the
 * same `TokenStream` and `SuffixArrayResult` shapes defined here.
 *
 * Mapping to the public diagnostic shape (`@fugazi/types`'s
 * `CodeDuplicationIssue`):
 *
 *   CloneFamily.kind === 'type-1'  → CodeDuplicationIssue.cloneType === 1
 *   CloneFamily.occurrences[i].byteRange  → Issue.range (byte-offset based)
 *
 * Wave B handles the conversion. Wave A keeps everything internal so the
 * detector can evolve without churning the public surface.
 */

/**
 * Token kinds emitted by `tokenize`. `comment` is *only* visible in the raw
 * tokenizer output — `TokenStream.tokens` filters comments out before the
 * suffix-array layer ever sees them, since comment text is noise for clone
 * detection but useful for source-range reconstruction in earlier phases.
 */
export type TokenKind =
  | 'keyword'
  | 'identifier'
  | 'number'
  | 'string'
  | 'template'
  | 'regex'
  | 'punct'
  | 'comment';

/**
 * `Token` — canonical, source-located lexeme. `value` is the *normalized*
 * form: identifiers/keywords/numbers/punct verbatim, strings without
 * surrounding quotes (so `'foo'` and `"foo"` collide), templates verbatim
 * including any `${...}` interpolations.
 */
export interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly byteOffset: number;
  readonly byteLength: number;
}

/**
 * `TokenStream` — comment-free token sequence for one file. `file` is an
 * absolute POSIX path (caller's responsibility — the engine compares file
 * strings only by equality and lexical order).
 */
export interface TokenStream {
  readonly file: string;
  readonly tokens: readonly Token[];
}

/**
 * Suffix-array build product. All numeric storage is `Uint32Array` per
 * IMP-PERF-09 — the dictionary build phase uses `Map<string, number>` for
 * convenience, but every array reachable from this struct is typed.
 *
 *   - `tokens`         global concatenated stream (token-id-encoded). Token
 *                      id 0 is reserved for the inter-file sentinel; real
 *                      tokens get ids ≥ 1.
 *   - `suffixArray`    permutation: `suffixArray[i]` is the global offset of
 *                      the i-th suffix in sorted order.
 *   - `lcp`            Kasai's LCP. `lcp[0] = 0`; `lcp[i]` is the LCP between
 *                      `suffixArray[i]` and `suffixArray[i-1]` for i ≥ 1.
 *   - `fileBoundary`   `fileBoundary[k]` = global offset where file k starts.
 *                      Length = number of input streams.
 *   - `fileForToken`   parallel to `tokens`: `fileForToken[g]` is the file
 *                      index for global offset g. Sentinel positions also get
 *                      a file index — by convention, the file *to the left* of
 *                      the sentinel.
 */
export interface SuffixArrayResult {
  readonly tokens: Uint32Array;
  readonly suffixArray: Uint32Array;
  readonly lcp: Uint32Array;
  readonly fileBoundary: Uint32Array;
  readonly fileForToken: Uint32Array;
}

/**
 * One concrete instance of a clone. `tokenStart` / `tokenEnd` index into the
 * owning file's `TokenStream.tokens` (NOT the global stream). `byteRange` is
 * derived from the first token's `byteOffset` and the last token's
 * `byteOffset + byteLength`, so reporters can highlight the original source
 * span without re-tokenizing.
 */
export interface CloneOccurrence {
  readonly file: string;
  readonly tokenStart: number;
  readonly tokenEnd: number;
  readonly byteRange: { readonly start: number; readonly end: number };
}

/**
 * A maximal set of pairwise-equivalent token sequences. `tokenLength` is the
 * length of the matched window (constant across all occurrences for type-1).
 * `occurrences` always has length ≥ 2.
 */
export interface CloneFamily {
  readonly kind: 'type-1' | 'type-2' | 'type-3' | 'type-4';
  readonly tokenLength: number;
  readonly occurrences: readonly CloneOccurrence[];
}

/** Public options for the Type-1 detector. `minTokens` defaults to 50. */
export interface FindClonesOptions {
  readonly minTokens?: number;
}
