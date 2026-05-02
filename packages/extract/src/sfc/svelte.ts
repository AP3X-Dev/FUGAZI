/**
 * svelte.ts — Phase 3c.5 Dispatch B — Svelte SFC handler.
 *
 * Routes `.svelte` source through the `parse()` + `buildInventory()` pipeline,
 * mirroring `vue.ts`:
 *
 *   1. Extract `<script>` and `<script context="module">` blocks via regex.
 *      Both contribute imports and declarations.
 *   2. For each block: mask everything outside the block body with spaces
 *      (preserving newlines), parse the masked source, run the typed visitor.
 *   3. Walk the template — defined as everything OUTSIDE `<script>` and
 *      `<style>` blocks (no wrapping `<template>` tag in Svelte) — for:
 *        - `{...}` interpolation expressions (incl. Svelte block tags such as
 *          `{#if EXPR}`, `{#each EXPR as ...}`, `{#await EXPR}`,
 *          `{:else if EXPR}`, `{@const X = EXPR}`, `{@html EXPR}`,
 *          `{@debug EXPR}`).
 *        - Component tag references (PascalCase or kebab-case-imported).
 *        - `class="..."` attribute values.
 *        - `class:foo` / `class:foo={cond}` directive class names.
 *   4. Merge declarations / imports / usages from every script block plus the
 *      template-derived usages. Sort by `range.start.byteOffset` then by name,
 *      freeze.
 *
 * Identifier-usage filtering for interpolation: we collect candidate
 * identifiers via `buildInventory()` over the wrapped expression, then filter
 * to names present in `importedNames`. Svelte's store-prefix `$page` is mapped
 * by stripping the leading `$` and re-checking `importedNames`.
 *
 * Determinism (NFR-1): a single `.svelte` source produces byte-equal
 * `JSON.stringify(inventory)` across runs.
 */

import type { Range } from '@fugazi/types';
import { parse } from '../parsers/oxc.js';
import { buildInventory } from '../visitor/index.js';
import type { Declaration, Import, Inventory, Usage } from '../visitor/types.js';
import {
  type ScriptBlock,
  extractScriptBlocks,
  extractStyleBlocks,
  maskNonBlock,
} from './extract-blocks.js';

const TAG_OPEN_RE = /<([A-Za-z][A-Za-z0-9-]*)\b/g;
const CLASS_ATTR_RE = /\bclass\s*=\s*"([^"]*)"|\bclass\s*=\s*'([^']*)'/g;
const CLASS_DIRECTIVE_RE = /\bclass:([A-Za-z_$][A-Za-z0-9_$-]*)\b/g;
const SCRIPT_BLOCK_OUTER_RE = /<script\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_OUTER_RE = /<style\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/style>/gi;
const HTML_COMMENT_OUTER_RE = /<!--[\s\S]*?-->/g;

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

function collectImportedNames(scriptBody: string): Set<string> {
  // Recover local-binding names from `import ... from '...'` declarations via
  // a lightweight regex pass. Kept close to vue.ts so the two handlers behave
  // the same on identical script shapes.
  const names = new Set<string>();
  for (const m of scriptBody.matchAll(IMPORT_DECL_RE)) {
    const head = m[1] ?? '';
    extractImportNames(head, names);
  }
  return names;
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

async function processScript(
  source: string,
  filename: string,
  block: ScriptBlock,
): Promise<{
  declarations: readonly Declaration[];
  imports: readonly Import[];
  usages: readonly Usage[];
}> {
  if (block.src !== null) {
    const range = makeRange(block.bodyByteOffset, 0);
    return {
      declarations: [],
      imports: [{ kind: 'static', source: block.src, resolvable: true, range }],
      usages: [],
    };
  }
  if (block.body.length === 0) {
    return { declarations: [], imports: [], usages: [] };
  }
  const masked = maskNonBlock(
    source,
    block.bodyByteOffset,
    block.bodyByteOffset + block.body.length,
  );
  const result = await parse(masked, { filename, lang: block.lang });
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
 * Build a "template view" of the SFC: a string identical in length to
 * `source`, where every byte inside `<script>...</script>`, `<style>...</style>`,
 * and `<!--...-->` blocks has been replaced with a space (newlines preserved).
 * The resulting string contains exactly the template content at the SAME
 * byte offsets as the original SFC source — every regex hit therefore carries
 * its SFC-source-relative byteOffset directly.
 */
function buildTemplateView(source: string): string {
  const masked: MaskedRegion[] = [];
  for (const re of [SCRIPT_BLOCK_OUTER_RE, STYLE_BLOCK_OUTER_RE, HTML_COMMENT_OUTER_RE]) {
    for (const m of source.matchAll(re)) {
      if (m.index === undefined) continue;
      masked.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  if (masked.length === 0) return source;
  const len = source.length;
  let out = '';
  let cursor = 0;
  // Sort for deterministic walking; overlap is not expected but harmless.
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
  /** Byte offset of the opening `{` in the SFC source. */
  readonly braceOffset: number;
  /** Byte offset of the first character of `expr` within the SFC source. */
  readonly exprOffset: number;
  /** Raw expression text (whatever survived after directive-prefix stripping). */
  readonly expr: string;
}

/**
 * Find every top-level `{...}` brace pair in `templateView` and return the
 * inner expression along with its SFC-source-relative offsets. Tracks brace
 * depth so nested braces inside string literals or inline objects round-trip.
 *
 * Quoted-string awareness is intentionally minimal: a string literal's `{` /
 * `}` would normally be consumed by the parser anyway once we wrap and parse
 * the expression. The depth counter is sufficient for the directive-tag
 * shapes Svelte produces in practice.
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
    // Found `{` — scan forward, balancing braces and skipping strings.
    const braceStart = i;
    let depth = 1;
    let j = i + 1;
    while (j < len && depth > 0) {
      const c = templateView.charCodeAt(j);
      if (c === 0x27 /* ' */ || c === 0x22 /* " */ || c === 0x60 /* ` */) {
        // Skip string literal — also handles backslash escapes.
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
      // Unbalanced — abort and resume scanning past the opener.
      i = braceStart + 1;
      continue;
    }
    // [braceStart, j-1] is the `{...}` span; [braceStart+1, j-2] is the inner text.
    const inner = templateView.slice(braceStart + 1, j - 1);
    const stripped = stripDirectivePrefix(inner);
    if (stripped !== null) {
      out.push({
        braceOffset: braceStart,
        exprOffset: braceStart + 1 + stripped.skipChars,
        expr: stripped.expr,
      });
    }
    i = j;
  }
  return out;
}

interface StripResult {
  /** The expression text remaining after the prefix. */
  readonly expr: string;
  /** Number of characters skipped from the start of `inner`. */
  readonly skipChars: number;
}

/**
 * Strip Svelte directive prefixes from a brace-pair inner. Returns `null` if
 * the brace was a closing tag (`{/if}`, `{/each}`, etc.) — those carry no
 * expression to harvest.
 *
 * Handled prefixes:
 *   #if EXPR
 *   #each EXPR as ...
 *   #await EXPR
 *   #snippet name(params)   → expression = params (best-effort identifier walk)
 *   :else if EXPR
 *   :else
 *   :then ...               → no expression (binding only)
 *   :catch ...              → no expression (binding only)
 *   @const X = EXPR
 *   @html EXPR
 *   @debug EXPR
 *   /xxx                    → closing tag
 *
 * For shapes that only have a binding (no expression), returns an empty
 * expression which produces no usages downstream — that's safe.
 */
function stripDirectivePrefix(inner: string): StripResult | null {
  // Count leading whitespace to keep `skipChars` accurate.
  let lead = 0;
  while (lead < inner.length) {
    const c = inner.charCodeAt(lead);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) lead++;
    else break;
  }
  const body = inner.slice(lead);
  if (body === '') return null;
  const head = body.charAt(0);

  // `{/if}`, `{/each}`, `{/await}`, ... — closing tags, no expression.
  if (head === '/') return null;

  if (head === '#') {
    // #if EXPR | #each EXPR as ... | #await EXPR | #snippet name(params)
    const ifM = /^#if\s+([\s\S]+)$/.exec(body);
    if (ifM !== null) {
      const expr = ifM[1] ?? '';
      return { expr, skipChars: lead + body.length - expr.length };
    }
    const eachM = /^#each\s+([\s\S]+?)\s+as\s+/.exec(body);
    if (eachM !== null) {
      const expr = eachM[1] ?? '';
      return {
        expr,
        skipChars: lead + body.indexOf(expr),
      };
    }
    const awaitM = /^#await\s+([\s\S]+?)(?:\s+then\s+\w+)?$/.exec(body);
    if (awaitM !== null) {
      const expr = awaitM[1] ?? '';
      return { expr, skipChars: lead + body.indexOf(expr) };
    }
    // #snippet name(params) — no expression to harvest in spec scope.
    return { expr: '', skipChars: lead };
  }

  if (head === ':') {
    // :else if EXPR — extract trailing expression.
    const elseIfM = /^:else\s+if\s+([\s\S]+)$/.exec(body);
    if (elseIfM !== null) {
      const expr = elseIfM[1] ?? '';
      return { expr, skipChars: lead + body.length - expr.length };
    }
    // :else / :then [binding] / :catch [binding] — no expression.
    return { expr: '', skipChars: lead };
  }

  if (head === '@') {
    // @const X = EXPR — keep `X = EXPR` so identifier walk finds both names.
    const constM = /^@const\s+([\s\S]+)$/.exec(body);
    if (constM !== null) {
      const expr = constM[1] ?? '';
      return { expr, skipChars: lead + body.length - expr.length };
    }
    // @html EXPR | @debug EXPR
    const htmlM = /^@(?:html|debug|render)\s+([\s\S]+)$/.exec(body);
    if (htmlM !== null) {
      const expr = htmlM[1] ?? '';
      return { expr, skipChars: lead + body.length - expr.length };
    }
    return { expr: '', skipChars: lead };
  }

  // Plain interpolation `{expr}` — return the body verbatim.
  return { expr: body, skipChars: lead };
}

/**
 * Sentinel callee used to wrap brace-pair expressions. The parser collapses
 * a parenthesized expression into `UnknownExpression`, so we wrap with a
 * function-call shape (`__fugazi_expr_(EXPR);`) which always classifies as
 * `CallExpression` and lets the walker descend into the argument. The
 * sentinel's own identifier usage is filtered out by name match.
 */
const EXPR_WRAPPER_PREFIX = '__fugazi_expr_(';
const EXPR_WRAPPER_SUFFIX = ');';
const EXPR_WRAPPER_NAME = '__fugazi_expr_';

/**
 * Parse a snippet of expression-shaped text by wrapping it in
 * `__fugazi_expr_(EXPR);` so the parser sees a CallExpression — a recognised
 * union kind whose arguments are walked. The sentinel callee identifier is
 * filtered out by name. Returns inner identifier/member usages keyed by their
 * offset within the wrapped source (the caller subtracts the prefix length
 * to recover the offset into `expr` itself).
 *
 * `kind: 'member'` usages are returned alongside `'identifier'` because
 * Svelte interpolations like `{$page.url.pathname}` surface the leading
 * binding (`$page`) as the MemberExpression `object` slot — that's a
 * `'member'` Usage in our visitor, but the SFC layer's binding-lookup logic
 * still wants to record it.
 */
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
    // Subtract the wrapper prefix length to map back into `expr`.
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
  importedNames: ReadonlySet<string>,
): Promise<TemplateExtraction> {
  const view = buildTemplateView(source);
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

  // 3. class:foo directive class names.
  for (const m of view.matchAll(CLASS_DIRECTIVE_RE)) {
    if (m.index === undefined) continue;
    const cls = m[1];
    if (cls === undefined || cls === '') continue;
    // Offset of the class name = match start + length of "class:".
    const offset = m.index + 'class:'.length;
    usages.push({
      kind: 'css-class',
      name: cls,
      range: makeRange(offset, cls.length),
    });
  }

  // 4. {...} interpolation + Svelte block-tag expressions.
  const braces = findBraceExpressions(view);
  for (const brace of braces) {
    if (brace.expr === '') continue;
    const found = await harvestExpressionIdentifiers(brace.expr, filename);
    for (const id of found) {
      // Svelte store-prefix: `$page` → check `page` in importedNames too.
      let lookupName = id.name;
      if (!importedNames.has(lookupName) && lookupName.startsWith('$')) {
        const stripped = lookupName.slice(1);
        if (importedNames.has(stripped)) {
          lookupName = stripped;
        }
      }
      if (!importedNames.has(lookupName)) continue;
      const sfcOffset = brace.exprOffset + id.localOffset;
      usages.push({
        kind: 'identifier',
        name: lookupName,
        range: makeRange(sfcOffset, id.localLen),
      });
    }
  }

  return { usages };
}

export async function parseSvelteSFC(source: string, filename: string): Promise<Inventory> {
  const declarations: Declaration[] = [];
  const imports: Import[] = [];
  const usages: Usage[] = [];

  const scripts = extractScriptBlocks(source);
  const importedNames = new Set<string>();

  for (const block of scripts) {
    const out = await processScript(source, filename, block);
    declarations.push(...out.declarations);
    imports.push(...out.imports);
    usages.push(...out.usages);
    if (block.src === null) {
      collectImportedNames(block.body).forEach((n) => importedNames.add(n));
    }
  }

  // Drop style blocks from the template view so attributes inside CSS strings
  // (e.g. `content: "<div class=...>"`) never become tag-open matches.
  void extractStyleBlocks;
  const ext = await extractTemplateUsages(source, filename, importedNames);
  usages.push(...ext.usages);

  return Object.freeze({
    declarations: Object.freeze(sortBy(declarations)),
    imports: Object.freeze(sortBy(imports)),
    usages: Object.freeze(sortBy(usages)),
  }) satisfies Inventory;
}
