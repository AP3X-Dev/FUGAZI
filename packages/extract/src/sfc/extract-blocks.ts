/**
 * extract-blocks.ts — Phase 3c.5 — shared SFC block extractor.
 *
 * Regex-based extraction of `<script>`, `<style>`, and `<template>` blocks
 * from a Vue or Svelte SFC source string. Uses no full HTML parser and no
 * `@vue/compiler-sfc` runtime dependency. The regexes accept `>` inside
 * quoted attribute values and skip blocks that fall inside HTML comments.
 *
 * Position handling: `bodyByteOffset` is the index of the FIRST byte of the
 * block body within the original source. Combined with the `maskNonBlock`
 * helper, this lets the typed visitor see SFC-source coordinates directly —
 * `Range` byteOffsets / lines / columns produced by `parse(sourceWithMask)`
 * point into the .vue / .svelte file naturally, no post-walk translation.
 */

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const SCRIPT_TAG_OPEN_RE = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const STYLE_TAG_OPEN_RE = /<style\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const TEMPLATE_TAG_OPEN_RE = /<template\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i;
const SCRIPT_CLOSE = '</script>';
const STYLE_CLOSE = '</style>';
const TEMPLATE_CLOSE = '</template>';

const LANG_ATTR_RE = /\blang\s*=\s*["'](\w+)["']/;
const SRC_ATTR_RE = /(?:^|\s)src\s*=\s*["']([^"']+)["']/;
const SCOPED_ATTR_RE = /(?:^|\s)scoped(?:\s|$|=)/;
const MODULE_ATTR_RE = /(?:^|\s)module(?:\s|$|=)/;
const SETUP_ATTR_RE = /(?:^|\s)setup(?:\s|$|=)/;
const CONTEXT_MODULE_RE = /\bcontext\s*=\s*["']module["']/;

export type BlockLanguage = 'ts' | 'tsx' | 'js' | 'jsx';

export interface ScriptBlock {
  readonly body: string;
  readonly attrs: string;
  readonly bodyByteOffset: number;
  readonly lang: BlockLanguage;
  readonly src: string | null;
  readonly isSetup: boolean;
  readonly isContextModule: boolean;
}

export interface StyleBlock {
  readonly body: string;
  readonly attrs: string;
  readonly bodyByteOffset: number;
  readonly lang: string | null;
  readonly src: string | null;
  readonly scoped: boolean;
  readonly cssModule: boolean;
}

export interface TemplateBlock {
  readonly body: string;
  readonly bodyByteOffset: number;
}

function commentRanges(source: string): readonly [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of source.matchAll(HTML_COMMENT_RE)) {
    if (m.index === undefined) continue;
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function inAnyRange(pos: number, ranges: readonly [number, number][]): boolean {
  for (const [start, end] of ranges) {
    if (pos >= start && pos < end) return true;
  }
  return false;
}

function detectScriptLang(attrs: string): BlockLanguage {
  const m = attrs.match(LANG_ATTR_RE);
  const lang = m?.[1]?.toLowerCase();
  if (lang === 'ts') return 'ts';
  if (lang === 'tsx') return 'tsx';
  if (lang === 'jsx') return 'jsx';
  return 'js';
}

function attrAttrValue(attrs: string, re: RegExp): string | null {
  const m = attrs.match(re);
  return m?.[1] ?? null;
}

export function extractScriptBlocks(source: string): readonly ScriptBlock[] {
  const ranges = commentRanges(source);
  const scripts: ScriptBlock[] = [];
  for (const m of source.matchAll(SCRIPT_TAG_OPEN_RE)) {
    if (m.index === undefined) continue;
    if (inAnyRange(m.index, ranges)) continue;
    const attrs = m[1] ?? '';
    const bodyStart = m.index + m[0].length;
    const closeIdx = source.indexOf(SCRIPT_CLOSE, bodyStart);
    if (closeIdx === -1) continue;
    scripts.push({
      body: source.slice(bodyStart, closeIdx),
      attrs,
      bodyByteOffset: bodyStart,
      lang: detectScriptLang(attrs),
      src: attrAttrValue(attrs, SRC_ATTR_RE),
      isSetup: SETUP_ATTR_RE.test(attrs),
      isContextModule: CONTEXT_MODULE_RE.test(attrs),
    });
  }
  return scripts;
}

export function extractStyleBlocks(source: string): readonly StyleBlock[] {
  const ranges = commentRanges(source);
  const styles: StyleBlock[] = [];
  for (const m of source.matchAll(STYLE_TAG_OPEN_RE)) {
    if (m.index === undefined) continue;
    if (inAnyRange(m.index, ranges)) continue;
    const attrs = m[1] ?? '';
    const bodyStart = m.index + m[0].length;
    const closeIdx = source.indexOf(STYLE_CLOSE, bodyStart);
    if (closeIdx === -1) continue;
    styles.push({
      body: source.slice(bodyStart, closeIdx),
      attrs,
      bodyByteOffset: bodyStart,
      lang: attrAttrValue(attrs, LANG_ATTR_RE)?.toLowerCase() ?? null,
      src: attrAttrValue(attrs, SRC_ATTR_RE),
      scoped: SCOPED_ATTR_RE.test(attrs),
      cssModule: MODULE_ATTR_RE.test(attrs),
    });
  }
  return styles;
}

export function extractTemplateBlock(source: string): TemplateBlock | null {
  const ranges = commentRanges(source);
  TEMPLATE_TAG_OPEN_RE.lastIndex = 0;
  const m = TEMPLATE_TAG_OPEN_RE.exec(source);
  if (m === null) return null;
  if (inAnyRange(m.index, ranges)) return null;
  const bodyStart = m.index + m[0].length;
  const closeIdx = source.indexOf(TEMPLATE_CLOSE, bodyStart);
  if (closeIdx === -1) return null;
  return {
    body: source.slice(bodyStart, closeIdx),
    bodyByteOffset: bodyStart,
  };
}

/**
 * Replace every byte outside `[bodyStart, bodyEnd)` with a space, preserving
 * newline characters so line numbers stay aligned. The result is a string of
 * the same length as `source` where the parser sees only the given block as
 * actual code; positions in the parsed program are SFC-source-relative.
 *
 * Use this once per script block: build a masked source, call `parse(masked)`,
 * then `buildInventory(program)`. The Inventory's Range fields point into the
 * original .vue / .svelte file directly.
 */
export function maskNonBlock(source: string, bodyStart: number, bodyEnd: number): string {
  const len = source.length;
  let out = '';
  for (let i = 0; i < len; i++) {
    if (i >= bodyStart && i < bodyEnd) {
      out += source[i];
      continue;
    }
    const ch = source.charCodeAt(i);
    if (ch === 0x0a /* \n */ || ch === 0x0d /* \r */) {
      out += source[i];
    } else {
      out += ' ';
    }
  }
  return out;
}
