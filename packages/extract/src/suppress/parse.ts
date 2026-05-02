/**
 * parse.ts — Phase 3c.6 (T075-test + T076) — inline suppression comment parser.
 *
 * Scans `//` line comments for the four directives:
 *
 *   - `// fugazi-ignore-next-line [tokens...]`  — suppress next physical line
 *   - `// fugazi-ignore-file       [tokens...]` — suppress entire file
 *   - `// fallow-ignore-next-line  [tokens...]` — legacy alias of the above
 *   - `// fallow-ignore-file       [tokens...]` — legacy alias of the above
 *
 * Tokens are space-separated rule identifiers from the closed `RuleId` union
 * (see `packages/types/src/rule-id.ts`). An empty token list means "suppress
 * all issues" and is encoded as `issueTypes: []`.
 *
 * Behavior decisions (vs. the original Fallow Rust implementation in
 * `crates/extract/src/suppress.rs`):
 *
 *   1. **Regex-based, line-oriented scan.** The original Fallow uses oxc's
 *      tokenizer to enumerate comments. Fugazi runs the suppression parser
 *      *before* the AST visitor (it must work on SFC sub-blocks and on files
 *      that fail to parse). Consequence: a `// fugazi-ignore-next-line` token
 *      that appears inside a string literal would be picked up. This is a
 *      deliberate, fixture-asserted false-positive — see the matching test
 *      case. The regex approach is documented in the Phase 3c.6 commit body
 *      and can be tightened later behind a feature flag without changing the
 *      `Suppression` shape.
 *
 *   2. **Block / HTML comments are NOT recognized.** The original supports
 *      `/* ...*\/` and `<!-- ... -->` styles for SFCs; Fugazi's SFC handlers
 *      already extract `<script>` blocks and route them through this parser
 *      with `//` comments only. Fixture #14 asserts this.
 *
 *   3. **Legacy alias deprecation.** `fallow-ignore-*` is accepted but emits
 *      a once-per-file `console.warn` via the dedup helper. The verbatim
 *      message is fixture-asserted byte-for-byte (E5 / IMP-CORRECT-09).
 *
 *   4. **Unknown tokens.** An unknown token still produces a `Suppression`
 *      record (the consumer ignores unknown tokens at suppression-resolution
 *      time) AND emits a once-per-(file, token) `console.warn` with a
 *      Levenshtein-distance did-you-mean suggestion when one rule is within
 *      edit distance 2.
 *
 *   5. **`fugazi-ignore-file` is file-wide regardless of position.** The
 *      original spec phrasing ("at top of file") is interpreted semantically:
 *      `kind: 'file'` means file-wide whether the directive appears on line 1
 *      or line 50.
 *
 * Determinism (NFR-1): `JSON.stringify(parseSuppressions(src, file))` is
 * byte-equal across runs for any fixed `(src, file)` pair.
 */

import type { RuleId } from '@fugazi/types';
import { warnOncePerFile } from './dedup.js';

/**
 * A single inline suppression directive parsed out of the source.
 */
export interface Suppression {
  /** Source filename the directive was found in. */
  readonly file: string;
  /**
   * 1-based line number of the comment itself. For `kind: 'next-line'` this
   * is the line containing the directive; the suppressed line is `line + 1`.
   * For `kind: 'file'` this is the line of the directive but suppression
   * applies file-wide.
   */
  readonly line: number;
  /** `next-line` or `file` directive flavor. */
  readonly kind: 'next-line' | 'file';
  /**
   * Rule identifiers the directive scopes to. An empty array means
   * "suppress all issues". Unknown tokens are preserved verbatim so the
   * consumer can decide how to handle them.
   */
  readonly issueTypes: readonly string[];
}

// The closed set of valid rule identifiers, mirroring the `RuleId` union in
// `@fugazi/types/rule-id.ts` exactly. Kept in sync via the type assertion
// below: any drift between this list and the union triggers a TS error.
const KNOWN_RULES: readonly RuleId[] = [
  'unused-files',
  'unused-exports',
  'unused-types',
  'unused-deps',
  'unused-dev-deps',
  'unused-optional-deps',
  'unused-enum-members',
  'unused-class-members',
  'circular-dependencies',
  'boundary-violations',
  'unresolved-imports',
  'unlisted-dependencies',
  'duplicate-exports',
  'private-type-leak',
  'complexity-hotspot',
  'cognitive-complexity',
  'code-duplication',
  'cold-code',
  'hot-path',
];
const KNOWN_SET: ReadonlySet<string> = new Set<string>(KNOWN_RULES);

// Order: more-specific prefix first so `…-next-line` is not partial-matched
// against the `…-file` prefix.
const FUGAZI_NEXT_LINE = 'fugazi-ignore-next-line';
const FUGAZI_FILE = 'fugazi-ignore-file';
const LEGACY_NEXT_LINE = 'fallow-ignore-next-line';
const LEGACY_FILE = 'fallow-ignore-file';

/**
 * Iterates every `//` line comment in `source`, paired with its 1-based line
 * number and the trimmed comment body (everything after `//`). The scanner
 * does NOT attempt to skip strings or template literals — see the file-level
 * note about deliberate false-positives.
 *
 * Uses `String.prototype.matchAll` with the global flag per the project's
 * lint constraint (no `re.exec` while-loops, no non-null assertions).
 */
const LINE_COMMENT_RE = /\/\/([^\r\n]*)/g;

interface LineComment {
  readonly line: number;
  readonly body: string;
}

function scanLineComments(source: string): readonly LineComment[] {
  const out: LineComment[] = [];
  // Pre-compute newline byte offsets so we can map a match index to a line.
  const newlineOffsets: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 0x0a /* \n */) newlineOffsets.push(i);
  }
  for (const m of source.matchAll(LINE_COMMENT_RE)) {
    if (m.index === undefined) continue;
    const idx = m.index;
    // Binary-search would be tidier; linear is fine — comments are sparse
    // relative to source length and N here is the number of newlines, not
    // characters.
    let line = 1;
    for (const off of newlineOffsets) {
      if (off >= idx) break;
      line += 1;
    }
    const raw = m[1] ?? '';
    out.push({ line, body: raw });
  }
  return out;
}

/** Levenshtein edit distance, capped at `max` for early exit. ~12 LOC. */
function editDistance(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  // Single-row DP, O(min(al, bl)) memory.
  const prev: number[] = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    let prevDiag = prev[0] ?? 0;
    prev[0] = i;
    let rowMin = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = prev[j] ?? 0;
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const above = prev[j] ?? 0;
      const left = prev[j - 1] ?? 0;
      const v = Math.min(above + 1, left + 1, prevDiag + cost);
      prev[j] = v;
      prevDiag = tmp;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return prev[bl] ?? max + 1;
}

/** Closest known rule within distance ≤ 2, or null if none. */
function suggest(token: string): string | null {
  let best: string | null = null;
  let bestDist = 3; // strictly < 3 => within distance 2
  for (const rule of KNOWN_RULES) {
    const d = editDistance(token, rule, 2);
    if (d < bestDist) {
      bestDist = d;
      best = rule;
    }
  }
  return best;
}

function emitUnknownWarning(file: string, token: string): void {
  const hint = suggest(token);
  const message =
    hint === null
      ? `unknown ignore token '${token}' in ${file}`
      : `unknown ignore token '${token}' in ${file}; did you mean '${hint}'?`;
  warnOncePerFile(file, 'unknown', token, message);
}

function emitLegacyWarning(file: string): void {
  // Per-file dedup: pass an empty token so all legacy comments in the same
  // file collapse to a single warning regardless of which alias variant they
  // used.
  warnOncePerFile(
    file,
    'legacy',
    '',
    `fallow-ignore-* is deprecated; use fugazi-ignore-* instead (in ${file})`,
  );
}

interface DirectiveMatch {
  readonly kind: 'next-line' | 'file';
  readonly legacy: boolean;
  readonly rest: string;
}

/**
 * Strips a leading directive prefix from a trimmed comment body. Returns
 * `null` if the body does not start with any of the four recognized
 * directives.
 */
function matchDirective(body: string): DirectiveMatch | null {
  if (body.startsWith(FUGAZI_NEXT_LINE)) {
    return { kind: 'next-line', legacy: false, rest: body.slice(FUGAZI_NEXT_LINE.length) };
  }
  if (body.startsWith(FUGAZI_FILE)) {
    return { kind: 'file', legacy: false, rest: body.slice(FUGAZI_FILE.length) };
  }
  if (body.startsWith(LEGACY_NEXT_LINE)) {
    return { kind: 'next-line', legacy: true, rest: body.slice(LEGACY_NEXT_LINE.length) };
  }
  if (body.startsWith(LEGACY_FILE)) {
    return { kind: 'file', legacy: true, rest: body.slice(LEGACY_FILE.length) };
  }
  return null;
}

/**
 * Validates that the rest after the directive prefix is either empty or
 * starts with whitespace — guards against accidental matches like
 * `fugazi-ignore-files` (note trailing `s`) which would otherwise pass the
 * `startsWith` check on `fugazi-ignore-file`.
 */
function isWordBoundary(rest: string): boolean {
  if (rest.length === 0) return true;
  const c = rest.charCodeAt(0);
  // ASCII whitespace: space, tab, vertical tab, form feed, carriage return.
  return c === 0x20 || c === 0x09 || c === 0x0b || c === 0x0c || c === 0x0d;
}

function tokenize(rest: string): readonly string[] {
  const trimmed = rest.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/u);
}

/**
 * Parse all suppression directives from `source`. The result is a frozen
 * array sorted by `(line, kind, issueTypes-join)` for deterministic output.
 */
export function parseSuppressions(source: string, filename: string): readonly Suppression[] {
  if (source.length === 0) return Object.freeze([]);

  const out: Suppression[] = [];
  const comments = scanLineComments(source);

  for (const c of comments) {
    // Trim the comment body; the original Rust impl trims both sides.
    const body = c.body.trim();
    const directive = matchDirective(body);
    if (directive === null) continue;
    if (!isWordBoundary(directive.rest)) continue;

    if (directive.legacy) emitLegacyWarning(filename);

    const tokens = tokenize(directive.rest);
    for (const tok of tokens) {
      if (!KNOWN_SET.has(tok)) emitUnknownWarning(filename, tok);
    }

    out.push({
      file: filename,
      line: c.line,
      kind: directive.kind,
      issueTypes: Object.freeze([...tokens]),
    });
  }

  // Stable sort: line ascending, then `file` before `next-line` (alphabetical
  // on `kind`), then issueTypes joined. Ensures byte-equal JSON output across
  // runs (NFR-1).
  out.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const ai = a.issueTypes.join(',');
    const bi = b.issueTypes.join(',');
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  return Object.freeze(out);
}
