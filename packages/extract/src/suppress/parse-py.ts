/**
 * parse-py.ts — Phase 4a T308 — inline suppression-comment parser for Python.
 *
 * Mirrors the TS variant (`./parse.ts`) for Python's `#`-line-comment syntax.
 * Recognises four directives:
 *
 *   - `# fugazi-ignore-next-line [tokens...]`  — suppress next physical line
 *   - `# fugazi-ignore-file       [tokens...]` — suppress entire file
 *
 * Tokens are space-separated rule identifiers from the closed `RuleId` union
 * (see `packages/types/src/rule-id.ts`). An empty token list means "suppress
 * all issues" and is encoded as `issueTypes: []`.
 *
 * Behavior parity with the TS variant:
 *
 *   1. **Regex-based, line-oriented scan.** Suppression parsing happens
 *      BEFORE the AST visitor (it must work on parse-failed files too).
 *      Consequence: a `# fugazi-ignore-next-line` token inside a string
 *      literal would be picked up. This is a deliberate, fixture-asserted
 *      false-positive matching the TS behaviour. Future tightening (proper
 *      tokenization) would change the behavior — that change must be
 *      intentional.
 *
 *   2. **Triple-quoted string / docstring contents are NOT skipped.** The
 *      regex scans every `#` it sees on every line. A `# fugazi-ignore-*`
 *      directive inside a `"""docstring"""` would be matched.
 *
 *   3. **Unknown tokens.** An unknown token still produces a `Suppression`
 *      record AND emits a once-per-(file, token) `console.warn` with a
 *      Levenshtein-distance did-you-mean suggestion when one rule is within
 *      edit distance ≤ 2.
 *
 *   4. **`fugazi-ignore-file` is file-wide regardless of position.**
 *
 * Determinism (NFR-1): `JSON.stringify(parseSuppressionsPy(src, file))` is
 * byte-equal across runs for any fixed `(src, file)` pair.
 */

import type { RuleId } from '@fugazi/types';
import { warnOncePerFile } from './dedup.js';
import type { Suppression } from './parse.js';

// The closed set of valid rule identifiers. Kept in sync with `parse.ts` —
// duplicating the list here avoids a mutual-import cycle and keeps the
// language-specific parsers self-contained.
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

const FUGAZI_NEXT_LINE = 'fugazi-ignore-next-line';
const FUGAZI_FILE = 'fugazi-ignore-file';

/**
 * Iterates every `#` line comment in `source`, paired with its 1-based line
 * number and the trimmed comment body (everything after `#`). Uses
 * `String.prototype.matchAll` per the project's lint constraint (no
 * `re.exec` while-loops).
 *
 * The scanner does NOT skip strings or docstrings — see the file-level note
 * about the deliberate false-positive parity with the TS variant.
 */
const HASH_COMMENT_RE = /#([^\r\n]*)/g;

interface LineComment {
  readonly line: number;
  readonly body: string;
}

function scanHashComments(source: string): readonly LineComment[] {
  const out: LineComment[] = [];
  const newlineOffsets: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 0x0a /* \n */) newlineOffsets.push(i);
  }
  for (const m of source.matchAll(HASH_COMMENT_RE)) {
    if (m.index === undefined) continue;
    const idx = m.index;
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

/** Levenshtein edit distance, capped at `max` for early exit. */
function editDistance(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
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

function suggest(token: string): string | null {
  let best: string | null = null;
  let bestDist = 3;
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

interface DirectiveMatch {
  readonly kind: 'next-line' | 'file';
  readonly rest: string;
}

function matchDirective(body: string): DirectiveMatch | null {
  if (body.startsWith(FUGAZI_NEXT_LINE)) {
    return { kind: 'next-line', rest: body.slice(FUGAZI_NEXT_LINE.length) };
  }
  if (body.startsWith(FUGAZI_FILE)) {
    return { kind: 'file', rest: body.slice(FUGAZI_FILE.length) };
  }
  return null;
}

function isWordBoundary(rest: string): boolean {
  if (rest.length === 0) return true;
  const c = rest.charCodeAt(0);
  return c === 0x20 || c === 0x09 || c === 0x0b || c === 0x0c || c === 0x0d;
}

function tokenize(rest: string): readonly string[] {
  const trimmed = rest.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/u);
}

/**
 * Parse all suppression directives from a Python `source`. The result is a
 * frozen array sorted by `(line, kind, issueTypes-join)` for deterministic
 * output — identical contract to `parseSuppressions` for TS.
 */
export function parseSuppressionsPy(source: string, filename: string): readonly Suppression[] {
  if (source.length === 0) return Object.freeze([]);

  const out: Suppression[] = [];
  const comments = scanHashComments(source);

  for (const c of comments) {
    const body = c.body.trim();
    const directive = matchDirective(body);
    if (directive === null) continue;
    if (!isWordBoundary(directive.rest)) continue;

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

  out.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const ai = a.issueTypes.join(',');
    const bi = b.issueTypes.join(',');
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  return Object.freeze(out);
}
