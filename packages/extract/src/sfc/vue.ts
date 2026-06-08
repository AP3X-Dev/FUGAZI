/**
 * vue.ts — Phase 3c.5 — Vue SFC handler (T068-test + T069).
 *
 * Routes `.vue` source through the `parse()` + `buildInventory()` pipeline:
 *
 *   1. Extract `<script>` and `<script setup>` blocks via regex.
 *   2. For each block: mask everything outside the block body with spaces
 *      (preserving newlines), parse the masked source, run the typed visitor.
 *      Positions in the resulting Inventory are SFC-source-relative.
 *   3. Walk the `<template>` body for component tag references (PascalCase
 *      and kebab-case-imported) and class-name attribute values; emit those
 *      as additional Usage records (`kind: 'jsx'` for components,
 *      `kind: 'css-class'` for class names).
 *   4. Merge declarations / imports / usages from every script block plus the
 *      template usages, sort by `range.start.byteOffset` then by name, freeze.
 *
 * Parser strategy: regex-based block extraction, no `@vue/compiler-sfc`
 * runtime dependency. This keeps the install footprint small.
 * The plan spec listed `@vue/compiler-sfc` as the planned parser; the regex
 * approach is a deliberate deviation captured in the Phase 3c.5 commit body.
 *
 * Determinism (NFR-1): a single `.vue` source produces byte-equal
 * `JSON.stringify(inventory)` across runs.
 */

import type { Range } from '@fugazi/types';
import { parse } from '../parsers/oxc.js';
import { buildInventory } from '../visitor/index.js';
import type { Declaration, Import, Inventory, Usage } from '../visitor/types.js';
import {
  type ScriptBlock,
  extractScriptBlocks,
  extractTemplateBlock,
  maskNonBlock,
} from './extract-blocks.js';

const TAG_OPEN_RE = /<([A-Za-z][A-Za-z0-9-]*)\b/g;
const CLASS_ATTR_RE = /\bclass\s*=\s*"([^"]*)"|\bclass\s*=\s*'([^']*)'/g;

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
  // PascalCase: starts with uppercase ASCII
  const head = tag.charAt(0);
  if (head >= 'A' && head <= 'Z') return true;
  // kebab-case with at least one hyphen: custom element
  return tag.includes('-');
}

interface TemplateExtraction {
  readonly usages: readonly Usage[];
}

function extractTemplateUsages(
  templateBody: string,
  bodyByteOffset: number,
  importedNames: ReadonlySet<string>,
): TemplateExtraction {
  const usages: Usage[] = [];

  // Component tag references.
  for (const m of templateBody.matchAll(TAG_OPEN_RE)) {
    if (m.index === undefined) continue;
    const raw = m[1];
    if (raw === undefined) continue;
    if (!isComponentTag(raw)) continue;
    // Map kebab-case to PascalCase for binding lookup.
    const pascal = raw.includes('-') ? kebabToPascal(raw) : raw;
    const name = importedNames.has(pascal) ? pascal : raw;
    const tagOffset = bodyByteOffset + m.index + 1; // +1 for '<'
    usages.push({ kind: 'jsx', name, range: makeRange(tagOffset, raw.length) });
  }

  // Class-name attribute values.
  for (const m of templateBody.matchAll(CLASS_ATTR_RE)) {
    if (m.index === undefined) continue;
    const value = m[1] ?? m[2] ?? '';
    if (value === '') continue;
    // Locate the value's start within the matched attribute.
    const valueStart = m.index + m[0].indexOf(value);
    const tokens = value.split(/(\s+)/);
    let cursor = 0;
    for (const token of tokens) {
      if (token.length === 0 || /^\s+$/.test(token)) {
        cursor += token.length;
        continue;
      }
      const offset = bodyByteOffset + valueStart + cursor;
      usages.push({
        kind: 'css-class',
        name: token,
        range: makeRange(offset, token.length),
      });
      cursor += token.length;
    }
  }

  return { usages };
}

const IMPORT_DECL_RE = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
const ID_HEAD_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)/;
const NS_HEAD_RE = /^\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
const NAMED_AS_RE = /\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*$/;

function collectImportedNames(imports: readonly Import[], scriptBody: string): Set<string> {
  // The Inventory only carries import sources, not local-binding names. We
  // recover the local-binding names by re-scanning the script body via a
  // lightweight regex. This is a known limitation: complex destructured
  // imports (`import { foo as bar }`) extract `bar`. Default + namespace
  // imports use the form `import X from`, `import * as X from`. The set is
  // used purely to match template tags against imported components, so a
  // false negative on edge cases just means we emit the raw tag name.
  const names = new Set<string>();
  for (const m of scriptBody.matchAll(IMPORT_DECL_RE)) {
    const head = m[1] ?? '';
    extractImportNames(head, names);
  }
  // imports.length is unused in the regex pass — kept for future API surface.
  void imports;
  return names;
}

function extractImportNames(head: string, out: Set<string>): void {
  // head is the substring between `import` and `from`. Possible shapes:
  //   default
  //   * as ns
  //   { a, b as c }
  //   default, { a, b }
  //   default, * as ns
  let rest = head.trim();
  if (rest === '') return;
  // Default import (leading identifier)
  const defaultM = ID_HEAD_RE.exec(rest);
  const defaultName = defaultM?.[1];
  if (defaultM !== null && defaultName !== undefined) {
    out.add(defaultName);
    rest = rest.slice(defaultM[0].length).trim();
    if (rest.startsWith(',')) rest = rest.slice(1).trim();
  }
  // Namespace
  const nsM = NS_HEAD_RE.exec(rest);
  const nsName = nsM?.[1];
  if (nsM !== null && nsName !== undefined) {
    out.add(nsName);
    rest = rest.slice(nsM[0].length).trim();
  }
  // Named bindings
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

async function processScript(
  source: string,
  filename: string,
  block: ScriptBlock,
): Promise<{
  declarations: readonly Declaration[];
  imports: readonly Import[];
  usages: readonly Usage[];
}> {
  // External script via `src=...`: emit a side-effect import, no body to parse.
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

export async function parseVueSFC(source: string, filename: string): Promise<Inventory> {
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
      collectImportedNames(out.imports, block.body).forEach((n) => importedNames.add(n));
    }
  }

  const template = extractTemplateBlock(source);
  if (template !== null) {
    const ext = extractTemplateUsages(template.body, template.bodyByteOffset, importedNames);
    usages.push(...ext.usages);
  }

  return Object.freeze({
    declarations: Object.freeze(sortBy(declarations)),
    imports: Object.freeze(sortBy(imports)),
    usages: Object.freeze(sortBy(usages)),
  }) satisfies Inventory;
}
