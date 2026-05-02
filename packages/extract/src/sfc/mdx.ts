/**
 * mdx.ts — Phase 3c.5 Dispatch C — MDX handler.
 *
 * Routes `.mdx` source through the `parse()` + `buildInventory()` pipeline,
 * mirroring `vue.ts` / `svelte.ts` / `astro.ts`:
 *
 *   1. Mask code-fence ranges (```...```), tilde fences (~~~...~~~),
 *      inline-code spans (`...`), and HTML comments with whitespace
 *      (preserving newlines). Imports/exports inside fences MUST NOT count.
 *   2. Walk the masked source line by line and collect lines beginning with
 *      `import ` / `import{` / `export ` / `export{` (mirrors the original
 *      Fallow Rust pipeline `crates/extract/src/mdx.rs`). Multi-line imports
 *      are stitched via brace-depth tracking. Concatenate the collected lines
 *      into a synthetic TypeScript source, parse, and harvest the inventory.
 *   3. For JSX usage: walk the masked source for `<Component />` style tags
 *      (PascalCase only — lowercase tags are intrinsic HTML elements).
 *   4. For `{expr}` interpolations: same brace-pair extraction technique as
 *      `astro.ts`, intersected against the synthetic-source's imported names.
 *   5. Merge declarations / imports / usages, sort, freeze.
 *
 * Parser strategy: regex- and line-scan based extraction, no `@mdx-js/mdx`
 * runtime dependency. This is a deliberate deviation; matches the no-runtime-
 * parser policy established in Phase 3c.5 Dispatch A (Vue) and continued in
 * Dispatch B (Svelte). The plan spec called out `@mdx-js/mdx` as the planned
 * parser; the regex approach trades compositional fidelity for install
 * footprint and aligns with the rest of the SFC layer.
 *
 * Position handling caveat: declarations and imports harvested from the
 * synthetic-source pass carry SYNTHETIC-source byte offsets (not MDX-source-
 * relative). The same documented limitation applies to Vue / Svelte handlers.
 * Template-derived usages (jsx tags, brace expressions) DO carry MDX-source-
 * relative offsets because they are emitted directly from regex matches over
 * the masked view.
 *
 * Determinism (NFR-1): a single `.mdx` source produces byte-equal
 * `JSON.stringify(inventory)` across runs.
 */

import type { Range } from '@fugazi/types';
import { parse } from '../parsers/oxc.js';
import { buildInventory } from '../visitor/index.js';
import type { Declaration, Import, Inventory, Usage } from '../visitor/types.js';

const TAG_OPEN_RE = /<([A-Za-z][A-Za-z0-9]*)\b/g;
const HTML_COMMENT_OUTER_RE = /<!--[\s\S]*?-->/g;
// Fenced code blocks: lines beginning with ``` or ~~~ (with optional info).
const CODE_FENCE_RE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
// Inline code spans: backtick-delimited single-line strings. Conservative.
const INLINE_CODE_RE = /`[^`\n]*`/g;

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

function isComponentTag(tag: string): boolean {
  // MDX: only PascalCase identifies a component. Lowercase tags are intrinsic
  // HTML elements. Hyphenated custom-elements are rare in MDX and ignored to
  // avoid false positives against Markdown-emitted hyphenated content.
  const head = tag.charAt(0);
  return head >= 'A' && head <= 'Z';
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

interface MaskedRegion {
  readonly start: number;
  readonly end: number;
}

/**
 * Build a "scan view" of the MDX source: a string identical in length to
 * `source` where every byte inside fenced code blocks, inline code spans, and
 * HTML comments has been replaced with a space (newlines preserved). Imports
 * and tags inside these regions are masked away so the line-scan and tag-scan
 * cannot pick them up.
 */
function buildScanView(source: string): string {
  const masked: MaskedRegion[] = [];
  for (const re of [CODE_FENCE_RE, INLINE_CODE_RE, HTML_COMMENT_OUTER_RE]) {
    for (const m of source.matchAll(re)) {
      if (m.index === undefined) continue;
      masked.push({ start: m.index, end: m.index + m[0].length });
    }
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

/**
 * Stitch top-of-line `import` / `export` statements from the scan view into a
 * synthetic TypeScript source. Multi-line imports are tracked via brace depth,
 * mirroring the original Fallow Rust pipeline (`crates/extract/src/mdx.rs`).
 *
 * Returns an empty string when nothing is found.
 */
function extractStatements(scanView: string): string {
  const collected: string[] = [];
  let inMultiline = false;
  let braceDepth = 0;
  // Split on \n; keep `line` raw for re-emission.
  const lines = scanView.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (inMultiline) {
      collected.push(line);
      braceDepth += countChar(trimmed, 0x7b);
      braceDepth -= countChar(trimmed, 0x7d);
      const closesByFrom =
        trimmed.includes(' from ') || trimmed.includes(" from'") || trimmed.includes(' from"');
      if (braceDepth <= 0 || trimmed.endsWith(';') || closesByFrom) {
        inMultiline = false;
        braceDepth = 0;
      }
      continue;
    }
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('import{') ||
      trimmed.startsWith('export ') ||
      trimmed.startsWith('export{')
    ) {
      collected.push(line);
      braceDepth = countChar(trimmed, 0x7b) - countChar(trimmed, 0x7d);
      if (braceDepth > 0 && !trimmed.includes(' from ')) {
        inMultiline = true;
      }
    }
  }
  return collected.join('\n');
}

function countChar(s: string, code: number): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === code) n++;
  }
  return n;
}

interface BraceExpr {
  readonly exprOffset: number;
  readonly expr: string;
}

function findBraceExpressions(scanView: string): readonly BraceExpr[] {
  const out: BraceExpr[] = [];
  const len = scanView.length;
  let i = 0;
  while (i < len) {
    const ch = scanView.charCodeAt(i);
    if (ch !== 0x7b /* `{` */) {
      i++;
      continue;
    }
    const braceStart = i;
    let depth = 1;
    let j = i + 1;
    while (j < len && depth > 0) {
      const c = scanView.charCodeAt(j);
      if (c === 0x27 /* ' */ || c === 0x22 /* " */ || c === 0x60 /* ` */) {
        const quote = c;
        j++;
        while (j < len) {
          const cc = scanView.charCodeAt(j);
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
    const inner = scanView.slice(braceStart + 1, j - 1);
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

async function parseStatements(
  statements: string,
  filename: string,
): Promise<{
  declarations: readonly Declaration[];
  imports: readonly Import[];
  usages: readonly Usage[];
}> {
  if (statements === '') {
    return { declarations: [], imports: [], usages: [] };
  }
  const result = await parse(statements, { filename, lang: 'ts' });
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

interface TemplateExtraction {
  readonly usages: readonly Usage[];
}

async function extractTemplateUsages(
  scanView: string,
  filename: string,
  importedNames: ReadonlySet<string>,
): Promise<TemplateExtraction> {
  const usages: Usage[] = [];

  // 1. PascalCase JSX tag references.
  for (const m of scanView.matchAll(TAG_OPEN_RE)) {
    if (m.index === undefined) continue;
    const raw = m[1];
    if (raw === undefined) continue;
    if (!isComponentTag(raw)) continue;
    const tagOffset = m.index + 1; // +1 for '<'
    usages.push({ kind: 'jsx', name: raw, range: makeRange(tagOffset, raw.length) });
  }

  // 2. {expr} interpolations — harvest identifiers and intersect with imports.
  const braces = findBraceExpressions(scanView);
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

export async function parseMdx(source: string, filename: string): Promise<Inventory> {
  const declarations: Declaration[] = [];
  const imports: Import[] = [];
  const usages: Usage[] = [];

  const scanView = buildScanView(source);

  const statements = extractStatements(scanView);
  const importedNames = new Set<string>();
  if (statements !== '') {
    const out = await parseStatements(statements, filename);
    declarations.push(...out.declarations);
    imports.push(...out.imports);
    usages.push(...out.usages);
    collectImportedNames(statements).forEach((n) => importedNames.add(n));
  }

  const ext = await extractTemplateUsages(scanView, filename, importedNames);
  usages.push(...ext.usages);

  return Object.freeze({
    declarations: Object.freeze(sortBy(declarations)),
    imports: Object.freeze(sortBy(imports)),
    usages: Object.freeze(sortBy(usages)),
  }) satisfies Inventory;
}
