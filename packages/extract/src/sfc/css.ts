/**
 * css.ts — Phase 3c.5 Dispatch D — plain CSS / CSS-modules handler (T074).
 *
 * Routes `.css` and `.module.css` source through a regex-based extractor.
 * No JS parser involved: CSS class declarations and CSS-modules `composes:`
 * directives are pure text constructs, so a parser would buy us nothing.
 *
 * What we emit:
 *   - Class declarations: every `.foo` token in a selector position is emitted
 *     as a `Declaration` with `kind: 'css-class'`. We do not distinguish
 *     `.module.css` from plain `.css` here — every dotted name in selector
 *     space is a declaration. Module-resolution is a graph-layer concern.
 *   - `@import './x.css'` (and `@import url('./x.css')`) at any point in the
 *     file is emitted as a static `Import`.
 *   - `composes: foo, bar from './other.module.css'` inside a rule emits one
 *     static `Import` for the source plus one `Usage` per composed name with
 *     `kind: 'css-class'`. `composes: foo` (no `from`) emits only usages.
 *
 * What we deliberately ignore:
 *   - Custom properties (`--primary: red`) — the leading `--` keeps them out
 *     of the dotted-class regex.
 *   - At-rule bodies like `@media` / `@supports` — class declarations inside
 *     the nested body still match the dotted-class regex naturally.
 *   - URL imports (`url("https://...")`, `url("data:...")`) — the import
 *     regex captures only relative / bare specifiers; the strip pass also
 *     blanks out `url(...)` content so it cannot collide with class regex.
 *
 * Strip strategy: two levels.
 *   commentStripped  — block comments removed; preserves string literals so
 *                      @import / composes: regexes can read their args.
 *   selectorReady    — additionally blanks string literals + url() so the
 *                      dotted-class scanner cannot match inside content
 *                      strings or URL paths. Byte offsets are preserved
 *                      throughout so `m.index` aligns with the original
 *                      source for every emitted record.
 *
 * Determinism (NFR-1): a single `.css` source produces byte-equal
 * `JSON.stringify(inventory)` across runs. Class declarations are sorted by
 * `range.start.byteOffset` then by name; the inventory is `Object.freeze`d
 * before return.
 */

import type { Range } from '@fugazi/types';
import type { Declaration, Import, Inventory, Usage } from '../visitor/types.js';

// CSS @import — supports `@import "x.css"`, `@import 'x.css'`,
// `@import url("x.css")`, `@import url('x.css')`, `@import url(x.css)`.
const CSS_IMPORT_RE =
  /@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)|"([^"]+)"|'([^']+)')/g;

// composes: name1[, name2 ...] [from "./x.module.css"|'./x.module.css'];
// The names list ends at `from`, `;`, or `}`.
const COMPOSES_RE =
  /\bcomposes\s*:\s*([^;}]+?)(?:\s+from\s+(?:"([^"]+)"|'([^']+)'))?\s*(?:;|(?=\}))/g;

// Class-name token in any selector context.
const CSS_CLASS_RE = /\.([A-Za-z_][A-Za-z0-9_-]*)/g;

// Block-comment stripper. Run first against the original source so neither
// `@import` / `composes:` nor class-name scanners see directives buried in
// comments.
const COMMENT_RE = /\/\*[\s\S]*?\*\//g;

// String + url() stripper. Run AFTER `@import` / `composes:` extraction
// (which depend on string literals) but BEFORE class-name scanning so e.g.
// `content: ".foo"` does not fabricate a `.foo` declaration.
const STRING_AND_URL_RE = /"[^"]*"|'[^']*'|url\([^)]*\)/g;

// Identifier name — used to validate composed names parsed from a `composes:`
// declaration value (defensive: we already split on commas).
const COMPOSE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function makeRange(byteOffset: number, len: number): Range {
  return {
    start: { line: 1, column: 0, byteOffset },
    end: { line: 1, column: len, byteOffset: byteOffset + len },
  };
}

/**
 * Replace each match of `re` in `source` with a run of spaces of the same
 * length. Preserves byte offsets so subsequent regex passes can reuse
 * `m.index` directly against the original source.
 */
function blankMatches(source: string, re: RegExp): string {
  let out = source;
  for (const m of source.matchAll(re)) {
    if (m.index === undefined) continue;
    const start = m.index;
    const end = start + m[0].length;
    out = `${out.slice(0, start)}${' '.repeat(end - start)}${out.slice(end)}`;
  }
  return out;
}

// Mask `composes:` declarations so the dotted-class scanner does not see the
// names list as fresh declarations. Thin alias around `blankMatches`.
function maskComposesDeclarations(scrubbed: string): string {
  return blankMatches(scrubbed, COMPOSES_RE);
}

interface Sortable {
  readonly range: { readonly start: { readonly byteOffset: number } };
  readonly name?: string;
  readonly source?: string;
}

function sortBy<T extends Sortable>(arr: readonly T[]): T[] {
  return arr.slice().sort((a, b) => {
    const offsetDelta = a.range.start.byteOffset - b.range.start.byteOffset;
    if (offsetDelta !== 0) return offsetDelta;
    const aTie = a.name ?? a.source ?? '';
    const bTie = b.name ?? b.source ?? '';
    return aTie < bTie ? -1 : aTie > bTie ? 1 : 0;
  });
}

interface ComposesHit {
  readonly source: string | null;
  readonly sourceOffset: number;
  readonly names: readonly { readonly name: string; readonly offset: number }[];
}

/**
 * Walks the scrubbed source for `composes:` declarations and yields, for
 * each one, the from-source (or null for local composition) plus the list of
 * composed names with their byte offsets in the original source.
 */
function extractComposes(scrubbed: string): readonly ComposesHit[] {
  const out: ComposesHit[] = [];
  for (const m of scrubbed.matchAll(COMPOSES_RE)) {
    if (m.index === undefined) continue;
    const namesRaw = m[1] ?? '';
    const fromQuoted = m[2] ?? m[3] ?? null;

    // Locate the names span inside the full match.
    const namesStartInMatch = m[0].indexOf(namesRaw);
    if (namesStartInMatch < 0) continue;
    const namesAbs = m.index + namesStartInMatch;

    // Locate the from-source span inside the full match (if any).
    let sourceOffset = -1;
    if (fromQuoted !== null) {
      const idx = m[0].indexOf(fromQuoted, namesStartInMatch + namesRaw.length);
      sourceOffset = idx < 0 ? -1 : m.index + idx;
    }

    // Split names on commas; preserve offsets so usages point at the right token.
    const names: { name: string; offset: number }[] = [];
    let cursor = 0;
    for (const part of namesRaw.split(',')) {
      const leadingWs = part.length - part.trimStart().length;
      const trimmed = part.trim();
      if (trimmed !== '' && COMPOSE_NAME_RE.test(trimmed)) {
        names.push({ name: trimmed, offset: namesAbs + cursor + leadingWs });
      }
      cursor += part.length + 1; // +1 for the consumed comma
    }

    out.push({
      source: fromQuoted,
      sourceOffset,
      names,
    });
  }
  return out;
}

export function parseCss(source: string, _filename: string): Inventory {
  if (source.length === 0) {
    return Object.freeze({
      declarations: Object.freeze<Declaration[]>([]),
      imports: Object.freeze<Import[]>([]),
      usages: Object.freeze<Usage[]>([]),
    }) satisfies Inventory;
  }

  const declarations: Declaration[] = [];
  const imports: Import[] = [];
  const usages: Usage[] = [];

  const commentStripped = blankMatches(source, COMMENT_RE);
  const selectorReady = blankMatches(commentStripped, STRING_AND_URL_RE);

  // 1. @import directives.
  for (const m of commentStripped.matchAll(CSS_IMPORT_RE)) {
    if (m.index === undefined) continue;
    const specifier = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    if (specifier === '') continue;
    if (
      specifier.startsWith('http://') ||
      specifier.startsWith('https://') ||
      specifier.startsWith('data:')
    ) {
      continue;
    }
    imports.push({
      kind: 'static',
      source: specifier,
      resolvable: true,
      range: makeRange(m.index, m[0].length),
    });
  }

  // 2. composes: declarations — emit imports + class-class usages.
  const composesHits = extractComposes(commentStripped);
  for (const hit of composesHits) {
    if (hit.source !== null && hit.sourceOffset >= 0) {
      imports.push({
        kind: 'static',
        source: hit.source,
        resolvable: true,
        range: makeRange(hit.sourceOffset, hit.source.length),
      });
    }
    for (const named of hit.names) {
      usages.push({
        kind: 'css-class',
        name: named.name,
        range: makeRange(named.offset, named.name.length),
      });
    }
  }

  // 3. Class declarations — over `selectorReady` with composes declarations
  //    masked so e.g. `composes: bar from './x.module.css'` does not fabricate
  //    a `bar` declaration from the names list. The from-source path is
  //    already blanked because string literals were stripped above.
  const masked = maskComposesDeclarations(selectorReady);
  for (const m of masked.matchAll(CSS_CLASS_RE)) {
    if (m.index === undefined) continue;
    const name = m[1];
    if (name === undefined) continue;
    declarations.push({
      kind: 'css-class',
      name,
      exported: true,
      range: makeRange(m.index, m[0].length),
      members: [],
    });
  }

  return Object.freeze({
    declarations: Object.freeze(sortBy(declarations)),
    imports: Object.freeze(sortBy(imports)),
    usages: Object.freeze(sortBy(usages)),
  }) satisfies Inventory;
}
