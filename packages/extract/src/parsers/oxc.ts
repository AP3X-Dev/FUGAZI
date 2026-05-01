/**
 * oxc.ts — WASM parser adapter for @fugazi/extract (Wave 5b-2).
 *
 * Despite the filename, the underlying engine is currently @swc/wasm: there
 * is no maintained oxc-parser-wasm npm package as of 2026-04-30 (the unified
 * `oxc-parser` distribution ships native napi-rs bindings only, which would
 * require a Rust toolchain at install time and violate Fugazi's no-bundling
 * constraint). The 'oxc.ts' filename is preserved as a stable import path —
 * Wave 5b-3 may add a second engine for cross-validation, and the public
 * `parse` symbol is engine-agnostic by design.
 *
 * Contract:
 *   - WASM integrity / missing errors throw `FugaziParseError(WASM_INTEGRITY)`
 *     or `FugaziParseError(WASM_MISSING)` BEFORE any parser code runs.
 *   - Syntax errors are FAIL-SOFT: returned in `result.errors[]`, never thrown.
 *   - Empty source returns an empty `Program` with no errors.
 *   - A leading UTF-8 BOM is stripped defensively before parsing.
 *   - Output is deterministic byte-for-byte across runs for identical input.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Position, Range } from '@fugazi/types';
import { loadWasmModule } from '../wasm/load.js';
import type {
  ExportDeclaration,
  ImportDeclaration,
  Language,
  ParseError,
  ParseOptions,
  ParseResult,
  Program,
  Statement,
  UnknownStatement,
} from './types.js';

export type { ParseError, ParseOptions, ParseResult, Program, Statement } from './types.js';

const BLOB_KEY = 'swc';
const BOM = '﻿';

// Resolve <packages/extract>/ from this file. import.meta.url at runtime points
// at <pkg>/dist/parsers/oxc.js (built) or <pkg>/src/parsers/oxc.ts (vitest);
// in both layouts the parent of `parsers` is the package root sibling of
// `wasm/manifest.json`. Same pattern as wasm/integrity.ts.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface SwcSpan {
  readonly start: number;
  readonly end: number;
}

interface SwcNode {
  readonly type: string;
  readonly span: SwcSpan;
  readonly source?: { readonly value: string } | null;
}

interface SwcModule {
  readonly type: 'Module' | 'Script';
  readonly span: SwcSpan;
  readonly body: readonly SwcNode[];
}

interface SwcParseOptions {
  readonly syntax: 'typescript' | 'ecmascript';
  readonly tsx?: boolean;
  readonly jsx?: boolean;
  readonly decorators?: boolean;
}

interface SwcModuleExports {
  parseSync(src: string, opts: SwcParseOptions): SwcModule;
}

let cachedSwc: SwcModuleExports | null = null;

async function ensureSwcLoaded(): Promise<SwcModuleExports> {
  // 1) Verify + compile the pinned WASM blob via the shared loader. This
  //    throws FugaziParseError(WASM_INTEGRITY|WASM_MISSING) on a bad pin or
  //    missing file. The compiled module itself is unused here — @swc/wasm
  //    does its own instantiation internally, but the integrity check has
  //    already gated import below.
  await loadWasmModule(BLOB_KEY, PACKAGE_ROOT);

  if (cachedSwc !== null) {
    return cachedSwc;
  }

  // 2) Dynamic import — happens AFTER the integrity check so a tampered blob
  //    never reaches WebAssembly.Instance. The package is CommonJS; bun/Node
  //    expose its exports under `.default` when imported via ESM.
  const mod = (await import('@swc/wasm')) as { default?: SwcModuleExports } & SwcModuleExports;
  const exported = mod.default ?? mod;
  cachedSwc = exported;
  return exported;
}

function stripBom(source: string): string {
  return source.startsWith(BOM) ? source.slice(BOM.length) : source;
}

function swcOptionsFor(lang: Language): SwcParseOptions {
  switch (lang) {
    case 'ts':
      return { syntax: 'typescript', tsx: false, decorators: true };
    case 'tsx':
      return { syntax: 'typescript', tsx: true, decorators: true };
    case 'js':
      return { syntax: 'ecmascript', jsx: false, decorators: true };
    case 'jsx':
      return { syntax: 'ecmascript', jsx: true, decorators: true };
  }
}

/**
 * codeStep — for a JS string `s` at index `i`, returns how many UTF-8 bytes
 * the character occupies (`bytes`), how many UTF-16 code units (`u16`), and
 * how many JS-string indices to advance (`chars`). Surrogate pairs count as
 * 4 bytes / 2 UTF-16 units / 2 JS char indices.
 */
function codeStep(s: string, i: number): { bytes: number; u16: number; chars: number } {
  const code = s.charCodeAt(i);
  if (code < 0x80) return { bytes: 1, u16: 1, chars: 1 };
  if (code < 0x800) return { bytes: 2, u16: 1, chars: 1 };
  if (code >= 0xd800 && code <= 0xdbff) return { bytes: 4, u16: 2, chars: 2 };
  return { bytes: 3, u16: 1, chars: 1 };
}

/**
 * buildLineOffsets — byte offset of each line start in `source`. Index `i`
 * is the start of line `i+1` (lines are 1-based). Built once per parse.
 */
function buildLineOffsets(source: string): readonly number[] {
  const offsets: number[] = [0];
  let byte = 0;
  for (let i = 0; i < source.length; ) {
    const step = codeStep(source, i);
    byte += step.bytes;
    i += step.chars;
    if (source.charCodeAt(i - step.chars) === 0x0a) offsets.push(byte);
  }
  return offsets;
}

/**
 * positionAt — convert a 0-based UTF-8 byte offset to a `Position`.
 * `column` is 0-based UTF-16 code units (LSP semantics). Negative or
 * out-of-range inputs return {1,0,0} defensively.
 */
function positionAt(source: string, lineOffsets: readonly number[], byteOffset: number): Position {
  if (byteOffset < 0) return { line: 1, column: 0, byteOffset: 0 };
  // Binary search: largest line offset <= byteOffset.
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((lineOffsets[mid] ?? 0) <= byteOffset) lo = mid;
    else hi = mid - 1;
  }
  const lineStartByte = lineOffsets[lo] ?? 0;
  // Walk to lineStartByte to find the JS-string index of the line start.
  let byte = 0;
  let charIndex = 0;
  while (byte < lineStartByte && charIndex < source.length) {
    const step = codeStep(source, charIndex);
    byte += step.bytes;
    charIndex += step.chars;
  }
  // Walk to byteOffset counting UTF-16 units.
  let u16Col = 0;
  while (byte < byteOffset && charIndex < source.length) {
    const step = codeStep(source, charIndex);
    byte += step.bytes;
    u16Col += step.u16;
    charIndex += step.chars;
  }
  return { line: lo + 1, column: u16Col, byteOffset };
}

interface SpanContext {
  readonly source: string;
  readonly lineOffsets: readonly number[];
  readonly base: number;
}

function rangeOf(node: SwcNode, ctx: SpanContext): Range {
  const localStart = node.span.start - ctx.base;
  const localEnd = node.span.end - ctx.base;
  return {
    start: positionAt(ctx.source, ctx.lineOffsets, localStart),
    end: positionAt(ctx.source, ctx.lineOffsets, localEnd),
  };
}

function classify(node: SwcNode, ctx: SpanContext): Statement {
  const range = rangeOf(node, ctx);
  if (node.type === 'ImportDeclaration') {
    const importDecl: ImportDeclaration = {
      kind: 'ImportDeclaration',
      source: node.source?.value ?? '',
      range,
    };
    return importDecl;
  }
  if (
    node.type === 'ExportNamedDeclaration' ||
    node.type === 'ExportDeclaration' ||
    node.type === 'ExportDefaultDeclaration' ||
    node.type === 'ExportDefaultExpression' ||
    node.type === 'ExportAllDeclaration'
  ) {
    const exportDecl: ExportDeclaration = {
      kind: 'ExportDeclaration',
      source: node.source?.value ?? null,
      range,
    };
    return exportDecl;
  }
  const unknown: UnknownStatement = { kind: 'UnknownStatement', range };
  return unknown;
}

/**
 * Extract a 1-based line number from SWC's text-formatted error output. The
 * format is a multi-line string with a frame:
 *     ` 1 | const x = ;`
 *     `   :           ^`
 * We capture the first `<digits> |` pair we see; absent that, default to 1.
 */
function lineFromMessage(message: string): number {
  const match = /(?:^|\n)\s*(\d+)\s*\|/.exec(message);
  if (match === null) return 1;
  const parsed = Number.parseInt(match[1] ?? '1', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * Parse a TypeScript / JavaScript source into Fugazi's discriminated-union
 * AST. See file-level docstring for the full contract.
 */
export async function parse(source: string, opts: ParseOptions): Promise<ParseResult> {
  const swc = await ensureSwcLoaded();
  const stripped = stripBom(source);
  const lineOffsets = buildLineOffsets(stripped);
  const swcOpts = swcOptionsFor(opts.lang);

  let mod: SwcModule;
  try {
    mod = swc.parseSync(stripped, swcOpts);
  } catch (cause) {
    // SWC throws a verbatim text diagnostic (string) for parse errors.
    // Preserve byte-for-byte per IMP-CORRECT-09.
    const message = typeof cause === 'string' ? cause : String(cause);
    const line = lineFromMessage(message);
    const lineStart = lineOffsets[line - 1] ?? 0;
    const error: ParseError = {
      file: opts.filename,
      position: { line, column: 0, byteOffset: lineStart },
      message,
      code: 'PARSE_SYNTAX_ERROR',
    };
    return { program: null, errors: [error] };
  }

  const ctx: SpanContext = {
    source: stripped,
    lineOffsets,
    base: mod.span.start,
  };
  const body = mod.body.map((n) => classify(n, ctx));
  const program: Program = {
    kind: 'Program',
    body,
    filename: opts.filename,
    language: opts.lang,
    range: {
      start: positionAt(stripped, lineOffsets, 0),
      end: positionAt(stripped, lineOffsets, mod.span.end - mod.span.start),
    },
  };
  return { program, errors: [] };
}
