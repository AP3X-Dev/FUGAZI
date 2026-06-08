/**
 * astro.ts — Phase 3c.5 Dispatch C — Astro SFC handler.
 *
 * Routes `.astro` source through the `parse()` + `buildInventory()` pipeline,
 * mirroring `vue.ts` and `svelte.ts`:
 *
 *   1. Detect Astro frontmatter — TypeScript code delimited by `---` lines at
 *      the start of the file. The frontmatter language is ALWAYS TypeScript
 *      (Astro's documented behaviour); the parser is invoked with `lang: 'ts'`
 *      regardless of any file-level convention.
 *   2. If frontmatter is present: mask everything outside the frontmatter body
 *      with spaces (preserving newlines), parse the masked source, run the
 *      typed visitor. Positions in the resulting Inventory are SFC-source-
 *      relative.
 *   3. The "template" is everything after the closing `---`. Walk it for:
 *        - Component tag references (PascalCase or kebab-case-imported)
 *          → `kind: 'jsx'`.
 *        - `class="..."` attribute values → `kind: 'css-class'`.
 *        - `{expr}` JSX-style interpolations → identifier usages intersected
 *          against the frontmatter's imported binding names.
 *   4. Merge declarations / imports / usages from the frontmatter plus the
 *      template usages. Sort by `range.start.byteOffset` then by name, freeze.
 *
 * Parser strategy: regex-based frontmatter extraction, no `@astrojs/compiler`
 * runtime dependency. This follows the no-runtime-parser policy established in
 * Phase 3c.5 Dispatch A (Vue) and continued in Dispatch B (Svelte). The
 * frontmatter is matched with a `(?s)\A\s*---...---`-style pattern.
 *
 * Determinism (NFR-1): a single `.astro` source produces byte-equal
 * `JSON.stringify(inventory)` across runs.
 */

import type { Range } from '@fugazi/types';
import { parse } from '../parsers/oxc.js';
import { buildInventory } from '../visitor/index.js';
import type { Declaration, Import, Inventory, Usage } from '../visitor/types.js';
import { maskNonBlock } from './extract-blocks.js';

const TAG_OPEN_RE = /<([A-Za-z][A-Za-z0-9-]*)\b/g;
const CLASS_ATTR_RE = /\bclass\s*=\s*"([^"]*)"|\bclass\s*=\s*'([^']*)'/g;
const HTML_COMMENT_OUTER_RE = /<!--[\s\S]*?-->/g;

// Astro frontmatter: leading `---\n` ... `\n---\n?` at file start. We allow a
// small amount of leading whitespace before the opening fence, equivalent to
// the pattern `(?s)\A\s*---[ \t]*\r?\n(?P<body>.*?\r?\n)---`.
const FRONTMATTER_RE = /^\s*---[ \t]*\r?\n([\s\S]*?\r?\n)---\r?\n?/;

const IMPORT_DECL_RE = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
const ID_HEAD_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)/;
const NS_HEAD_RE = /^\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
const NAMED_AS_RE = /\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*$/;

function makeRange(byteOffset: number, len: number, lineHint = 1, colHint = 0): Range {
  return {
    start: { line: lineHint, column: colHint, byteOffset },
    end: { line: lineHint, column: colHint + len, byteOffset: byteOffset + len },
  };
}

function kebabToPascal(name: string): string {
  return name
    .split('-')
    .map((part) => {
      const head = part.charAt(0);
      return head === '' ? '' : head.toUpperCase() + part.slice(1);
    })
    .join('');
}

function isComponentTag(tag: string): boolean {
  const head = tag.charAt(0);
  if (head >= 'A' && head <= 'Z') return true;
  return tag.includes('-');
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

function extractImportNames(head: string, out: Set<string>): void {
  let rest = head.trim();
  if (rest === '') return;
  const defaultM = ID_HEAD_RE.exec(rest);
  const defaultName = defaultM?.[1];
  if (defaultM !== null && defaultName !== undefined) {
    out.add(defaultName);
    rest = rest.slice(defaultM[0].length).trim();
    if (rest.startsWith(',')) rest = rest.slice(1).trim();
  }
  const nsM = NS_HEAD_RE.exec(rest);
  const nsName = nsM?.[1];
  if (nsM !== null && nsName !== undefined) {
    out.add(nsName);
    rest = rest.slice(nsM[0].length).trim();
  }
  if (rest.startsWith('{') && rest.endsWith('}')) {
    const inner = rest.slice(1, -1);
    for (const part of inner.split(',')) {
      const trimmed = part.trim();
      if (trimmed === '') continue;
      const asM = NAMED_AS_RE.exec(trimmed);
      const asName = asM?.[1];
      if (asM !== null && asName !== undefined) {
        out.add(asName);
        continue;
      }
      const idM = ID_HEAD_RE.exec(trimmed);
      const idName = idM?.[1];
      if (idM !== null && idName !== undefined) out.add(idName);
    }
  }
}

function collectImportedNames(scriptBody: string): Set<string> {
  const names = new Set<string>();
  for (const m of scriptBody.matchAll(IMPORT_DECL_RE)) {
    const head = m[1] ?? '';
    extractImportNames(head, names);
  }
  return names;
}

interface FrontmatterMatch {
  readonly body: string;
  /** Byte offset of the first byte of the frontmatter body within the source. */
  readonly bodyByteOffset: number;
  /** Byte offset just past the closing `---\n` (start of template region). */
  readonly templateStart: number;
}

function detectFrontmatter(source: string): FrontmatterMatch | null {
  const m = FRONTMATTER_RE.exec(source);
  if (m === null) return null;
  const body = m[1] ?? '';
  // The body capture group sits immediately after the opening `---\n`. Locate
  // it by scanning from the match start through to the first newline that
  // closes the opening fence — the body begins at the byte AFTER that newline.
  const matchStart = m.index;
  const opener = m[0];
  const firstNewline = opener.indexOf('\n');
  if (firstNewline === -1) return null;
  const bodyByteOffset = matchStart + firstNewline + 1;
  return {
    body,
    bodyByteOffset,
    templateStart: matchStart + opener.length,
  };
}

async function parseFrontmatter(
  source: string,
  filename: string,
  fm: FrontmatterMatch,
): Promise<{
  declarations: readonly Declaration[];
  imports: readonly Import[];
  usages: readonly Usage[];
}> {
  if (fm.body.length === 0) {
    return { declarations: [], imports: [], usages: [] };
  }
  const masked = maskNonBlock(source, fm.bodyByteOffset, fm.bodyByteOffset + fm.body.length);
  const result = await parse(masked, { filename, lang: 'ts' });
  if (result.program === null) {
    return { declarations: [], imports: [], usages: [] };
  }
  const inv = buildInventory(result.program);
  return {
    declarations: inv.declarations,
    imports: inv.imports,
    usages: inv.usages,
  };
}

interface MaskedRegion {
  readonly start: number;
  readonly end: number;
}

/**
 * Build a "template view" of the Astro source: a string identical in length to
 * `source`, where every byte inside the frontmatter and HTML comments has been
 * replaced with a space (newlines preserved). Tag/class scans against this
 * view therefore carry SFC-source-relative byte offsets directly.
 *
 * `frontmatterEnd` is `templateStart` from the frontmatter detection — the
 * byte at which the template region begins. Bytes before that are masked.
 */
function buildTemplateView(source: string, frontmatterEnd: number): string {
  const masked: MaskedRegion[] = [];
  if (frontmatterEnd > 0) {
    masked.push({ start: 0, end: frontmatterEnd });
  }
  for (const m of source.matchAll(HTML_COMMENT_OUTER_RE)) {
    if (m.index === undefined) continue;
    masked.push({ start: m.index, end: m.index + m[0].length });
  }
  if (masked.length === 0) return source;
  const len = source.length;
  let out = '';
  let cursor = 0;
  const sorted = masked.slice().sort((a, b) => a.start - b.start);
  for (const region of sorted) {
    const start = Math.max(region.start, cursor);
    const end = Math.max(region.end, cursor);
    if (start > cursor) out += source.slice(cursor, start);
    for (let i = start; i < end && i < len; i++) {
      const ch = source.charCodeAt(i);
      if (ch === 0x0a /* \n */ || ch === 0x0d /* \r */) {
        out += source[i];
      } else {
        out += ' ';
      }
    }
    cursor = end;
  }
  if (cursor < len) out += source.slice(cursor);
  return out;
}

interface BraceExpr {
  readonly exprOffset: number;
  readonly expr: string;
}

/**
 * Find every top-level `{...}` brace pair in `templateView` and return the
 * inner expression along with its SFC-source-relative offsets. Tracks brace
 * depth so nested braces inside string literals or inline objects round-trip.
 *
 * Quoted-string awareness is intentionally minimal: a string literal's `{`/`}`
 * would normally be consumed by the parser anyway once the expression is
 * wrapped and parsed. The depth counter is sufficient for the JSX-style
 * shapes Astro produces in practice.
 */
function findBraceExpressions(templateView: string): readonly BraceExpr[] {
  const out: BraceExpr[] = [];
  const len = templateView.length;
  let i = 0;
  while (i < len) {
    const ch = templateView.charCodeAt(i);
    if (ch !== 0x7b /* `{` */) {
      i++;
      continue;
    }
    const braceStart = i;
    let depth = 1;
    let j = i + 1;
    while (j < len && depth > 0) {
      const c = templateView.charCodeAt(j);
      if (c === 0x27 /* ' */ || c === 0x22 /* " */ || c === 0x60 /* ` */) {
        const quote = c;
        j++;
        while (j < len) {
          const cc = templateView.charCodeAt(j);
          if (cc === 0x5c /* \ */) {
            j += 2;
            continue;
          }
          if (cc === quote) {
            j++;
            break;
          }
          j++;
        }
        continue;
      }
      if (c === 0x7b /* { */) depth++;
      else if (c === 0x7d /* } */) depth--;
      j++;
    }
    if (depth !== 0) {
      i = braceStart + 1;
      continue;
    }
    const inner = templateView.slice(braceStart + 1, j - 1);
    if (inner.trim() !== '') {
      out.push({ exprOffset: braceStart + 1, expr: inner });
    }
    i = j;
  }
  return out;
}

const EXPR_WRAPPER_PREFIX = '__fugazi_expr_(';
const EXPR_WRAPPER_SUFFIX = ');';
const EXPR_WRAPPER_NAME = '__fugazi_expr_';

async function harvestExpressionIdentifiers(
  expr: string,
  filename: string,
): Promise<readonly { name: string; localOffset: number; localLen: number }[]> {
  const trimmed = expr.trim();
  if (trimmed === '') return [];
  const wrapped = `${EXPR_WRAPPER_PREFIX}${expr}${EXPR_WRAPPER_SUFFIX}`;
  const result = await parse(wrapped, { filename, lang: 'ts' });
  if (result.program === null) return [];
  const inv = buildInventory(result.program);
  const out: { name: string; localOffset: number; localLen: number }[] = [];
  for (const u of inv.usages) {
    if (u.kind !== 'identifier' && u.kind !== 'member') continue;
    if (u.name === EXPR_WRAPPER_NAME) continue;
    const localOffset = u.range.start.byteOffset - EXPR_WRAPPER_PREFIX.length;
    const localLen = u.range.end.byteOffset - u.range.start.byteOffset;
    out.push({ name: u.name, localOffset, localLen });
  }
  return out;
}

interface TemplateExtraction {
  readonly usages: readonly Usage[];
}

async function extractTemplateUsages(
  source: string,
  filename: string,
  frontmatterEnd: number,
  importedNames: ReadonlySet<string>,
): Promise<TemplateExtraction> {
  const view = buildTemplateView(source, frontmatterEnd);
  const usages: Usage[] = [];

  // 1. Component tag references.
  for (const m of view.matchAll(TAG_OPEN_RE)) {
    if (m.index === undefined) continue;
    const raw = m[1];
    if (raw === undefined) continue;
    if (!isComponentTag(raw)) continue;
    const pascal = raw.includes('-') ? kebabToPascal(raw) : raw;
    const name = importedNames.has(pascal) ? pascal : raw;
    const tagOffset = m.index + 1; // +1 for '<'
    usages.push({ kind: 'jsx', name, range: makeRange(tagOffset, raw.length) });
  }

  // 2. class="..." attribute values.
  for (const m of view.matchAll(CLASS_ATTR_RE)) {
    if (m.index === undefined) continue;
    const value = m[1] ?? m[2] ?? '';
    if (value === '') continue;
    const valueStart = m.index + m[0].indexOf(value);
    const tokens = value.split(/(\s+)/);
    let cursor = 0;
    for (const token of tokens) {
      if (token.length === 0 || /^\s+$/.test(token)) {
        cursor += token.length;
        continue;
      }
      const offset = valueStart + cursor;
      usages.push({
        kind: 'css-class',
        name: token,
        range: makeRange(offset, token.length),
      });
      cursor += token.length;
    }
  }

  // 3. {expr} JSX-style interpolations.
  const braces = findBraceExpressions(view);
  for (const brace of braces) {
    const found = await harvestExpressionIdentifiers(brace.expr, filename);
    for (const id of found) {
      if (!importedNames.has(id.name)) continue;
      const sfcOffset = brace.exprOffset + id.localOffset;
      usages.push({
        kind: 'identifier',
        name: id.name,
        range: makeRange(sfcOffset, id.localLen),
      });
    }
  }

  return { usages };
}

export async function parseAstroSFC(source: string, filename: string): Promise<Inventory> {
  const declarations: Declaration[] = [];
  const imports: Import[] = [];
  const usages: Usage[] = [];

  const fm = detectFrontmatter(source);
  const importedNames = new Set<string>();
  let frontmatterEnd = 0;

  if (fm !== null) {
    const out = await parseFrontmatter(source, filename, fm);
    declarations.push(...out.declarations);
    imports.push(...out.imports);
    usages.push(...out.usages);
    collectImportedNames(fm.body).forEach((n) => importedNames.add(n));
    frontmatterEnd = fm.templateStart;
  }

  const ext = await extractTemplateUsages(source, filename, frontmatterEnd, importedNames);
  usages.push(...ext.usages);

  return Object.freeze({
    declarations: Object.freeze(sortBy(declarations)),
    imports: Object.freeze(sortBy(imports)),
    usages: Object.freeze(sortBy(usages)),
  }) satisfies Inventory;
}
