/**
 * oxc.ts — WASM parser adapter for @fugazi/extract.
 *
 * Despite the filename, the underlying engine is currently @swc/wasm: there
 * is no maintained oxc-parser-wasm npm package as of 2026-04-30 (the unified
 * `oxc-parser` distribution ships native napi-rs bindings only, which would
 * require a Rust toolchain at install time and violate Fugazi's no-bundling
 * constraint). The 'oxc.ts' filename is preserved as a stable import path —
 * a future wave may add a second engine for cross-validation, and the public
 * `parse` symbol is engine-agnostic by design.
 *
 * Contract:
 *   - WASM integrity / missing errors throw `FugaziParseError(WASM_INTEGRITY)`
 *     or `FugaziParseError(WASM_MISSING)` BEFORE any parser code runs.
 *   - Syntax errors are FAIL-SOFT: returned in `result.errors[]`, never thrown.
 *   - Empty source returns an empty `Program` with no errors.
 *   - A leading UTF-8 BOM is stripped defensively before parsing.
 *   - Output is deterministic byte-for-byte across runs for identical input.
 *
 * Phase 3c.4 Dispatch A extended `classify()` to recognise the discriminated-
 * union AST kinds defined in `../ast/kinds.ts`. Statements not in the union
 * collapse to `UnknownStatement`; expressions not in the union collapse to
 * `UnknownExpression`. This is the boundary between SWC's broad node taxonomy
 * and Fugazi's narrower visitor surface.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Position, Range } from '@fugazi/types';
import type {
  BlockStatement,
  CallExpression,
  ClassDecl,
  EnumDecl,
  ExportDecl,
  Expression,
  ExpressionStatement,
  ForStatement,
  FunctionDecl,
  Identifier,
  IfStatement,
  ImportDecl,
  ImportMeta,
  JSXElement,
  Literal,
  MemberExpression,
  NewExpression,
  Program,
  Statement,
  SwitchStatement,
  TemplateLiteral,
  TypeDecl,
  UnknownExpression,
  UnknownStatement,
  VariableDecl,
  VariableDeclarator,
  WhileStatement,
} from '../ast/kinds.js';
import { loadWasmModule } from '../wasm/load.js';
import type { Language, ParseError, ParseOptions, ParseResult } from './types.js';

export type { ParseError, ParseOptions, ParseResult } from './types.js';
export type { Program, Statement } from '../ast/kinds.js';

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

/**
 * Loose SWC node shape — fields are read defensively because SWC's TypeScript
 * declarations are large and version-bumped frequently. Each `classify*`
 * function inspects only the keys it needs and treats absent fields as the
 * unclassified-fallback case.
 */
interface SwcNode {
  readonly type: string;
  readonly span: SwcSpan;
  // Top-level node fields the adapter reads:
  readonly source?: { readonly value: string } | null;
  readonly identifier?: SwcNode | null;
  readonly id?: SwcNode | null;
  readonly kind?: string;
  readonly declarations?: readonly SwcVariableDeclarator[];
  readonly body?: SwcNode | readonly SwcNode[] | null;
  readonly stmts?: readonly SwcNode[];
  readonly expression?: SwcNode | null;
  readonly callee?: SwcNode | null;
  readonly arguments?: readonly SwcCallArgument[];
  readonly object?: SwcNode | null;
  readonly property?: SwcNode | null;
  readonly value?: string | number | boolean | null;
  readonly opening?: { readonly name?: SwcNode | null } | null;
  readonly consequent?: SwcNode | readonly SwcNode[] | null;
  readonly alternate?: SwcNode | null;
  readonly cases?: readonly SwcSwitchCase[];
  readonly members?: readonly SwcNode[];
  readonly decorators?: readonly SwcNode[];
  readonly params?: readonly SwcNode[];
  readonly key?: SwcNode | string | null;
  readonly metaPropertyKind?: string;
  readonly meta?: SwcNode | null;
  // `import.meta` MetaProperty in SWC carries `kind: 'import.meta'`. The
  // generic `kind?: string` above already covers it.
  // TemplateLiteral / TaggedTemplateExpression fields:
  readonly quasis?: readonly SwcTemplateElement[];
  readonly expressions?: readonly SwcNode[];
  readonly tag?: SwcNode | null;
  readonly template?: SwcNode | null;
  // AwaitExpression / YieldExpression carry their inner expression in
  // `argument`. (CallExpression args use `arguments` above.)
  readonly argument?: SwcNode | null;
}

interface SwcTemplateElement {
  readonly type: 'TemplateElement';
  readonly span: SwcSpan;
  readonly cooked?: string | null;
  readonly raw?: string | null;
  readonly tail?: boolean;
}

interface SwcVariableDeclarator {
  readonly type: 'VariableDeclarator';
  readonly span: SwcSpan;
  readonly id: SwcNode;
}

interface SwcCallArgument {
  readonly expression: SwcNode;
}

interface SwcSwitchCase {
  readonly type: 'SwitchCase';
  readonly span: SwcSpan;
  readonly consequent: readonly SwcNode[];
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

function rangeOfSpan(span: SwcSpan, ctx: SpanContext): Range {
  return {
    start: positionAt(ctx.source, ctx.lineOffsets, span.start - ctx.base),
    end: positionAt(ctx.source, ctx.lineOffsets, span.end - ctx.base),
  };
}

/**
 * Read a string-typed name field off a loose SWC node (`identifier.value`,
 * `id.value`, etc.). The `SwcNode.value` field is typed permissively
 * (string | number | boolean | null) because the same shape carries literal
 * payloads; for name slots we coerce non-string values to `''`.
 */
function nameValueOf(v: string | number | boolean | null | undefined): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Map a single SWC statement-shaped node onto Fugazi's discriminated union.
 * Anything we don't recognise becomes `UnknownStatement` carrying just its
 * range — downstream code treats this as an opaque region.
 */
function classifyStatement(node: SwcNode, ctx: SpanContext): Statement {
  const range = rangeOf(node, ctx);
  switch (node.type) {
    case 'ImportDeclaration':
      return classifyImport(node, range);
    case 'ExportNamedDeclaration':
    case 'ExportDeclaration':
    case 'ExportDefaultDeclaration':
    case 'ExportDefaultExpression':
    case 'ExportAllDeclaration':
      return classifyExport(node, range, ctx);
    case 'FunctionDeclaration':
      return classifyFunctionDecl(node, range, ctx);
    case 'ClassDeclaration':
      return classifyClassDecl(node, range, ctx);
    case 'VariableDeclaration':
      return classifyVariableDecl(node, range, ctx);
    case 'TsTypeAliasDeclaration':
    case 'TsInterfaceDeclaration':
      return classifyTypeDecl(node, range);
    case 'TsEnumDeclaration':
      return classifyEnumDecl(node, range, ctx);
    case 'ExpressionStatement':
      return classifyExpressionStatement(node, range, ctx);
    case 'IfStatement':
      return classifyIf(node, range, ctx);
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
      return classifyFor(node, range, ctx);
    case 'WhileStatement':
    case 'DoWhileStatement':
      return classifyWhile(node, range, ctx);
    case 'SwitchStatement':
      return classifySwitch(node, range, ctx);
    case 'BlockStatement':
      return classifyBlock(node, range, ctx);
    default: {
      const unknown: UnknownStatement = { kind: 'UnknownStatement', range };
      return unknown;
    }
  }
}

function classifyImport(node: SwcNode, range: Range): ImportDecl {
  return {
    kind: 'ImportDecl',
    range,
    source: node.source?.value ?? '',
  };
}

function classifyExport(node: SwcNode, range: Range, ctx: SpanContext): ExportDecl {
  const wrapped = exportWrappedDeclaration(node, ctx);
  return {
    kind: 'ExportDecl',
    range,
    source: node.source?.value ?? null,
    ...(wrapped !== null ? { declaration: wrapped } : {}),
  };
}

/**
 * Extract a wrapped declaration from an SWC export node, if present. Returns
 * null when the export form carries no wrapped declaration (re-exports, bare
 * specifier exports, default-expression exports).
 *
 * Handled forms:
 *   - `export const x = 1;` / `export function f() {}` (`ExportDeclaration`)
 *   - `export default function f() {}` / `export default class C {}`
 *     (`ExportDefaultDeclaration` with `decl: FunctionExpression | ClassExpression`)
 *
 * `FunctionExpression` / `ClassExpression` are remapped to `FunctionDecl` /
 * `ClassDecl` respectively — they share the same structural shape, and the
 * visitor surface only cares about the discriminated kind.
 */
function exportWrappedDeclaration(node: SwcNode, ctx: SpanContext): Statement | null {
  // `export const x = 1;` and `export function f() {}` arrive as
  // `ExportDeclaration { declaration: Declaration }`.
  const direct = (node as { declaration?: SwcNode }).declaration;
  if (direct !== undefined && direct !== null) {
    return classifyStatement(direct, ctx);
  }
  // `export default function f() {}` arrives as
  // `ExportDefaultDeclaration { decl: FunctionExpression | ClassExpression | TsInterfaceDeclaration }`.
  const decl = (node as { decl?: SwcNode }).decl;
  if (decl !== undefined && decl !== null) {
    if (decl.type === 'FunctionExpression') {
      return classifyFunctionDecl(decl, rangeOf(decl, ctx), ctx);
    }
    if (decl.type === 'ClassExpression') {
      return classifyClassDecl(decl, rangeOf(decl, ctx), ctx);
    }
    if (decl.type === 'TsInterfaceDeclaration') {
      return classifyTypeDecl(decl, rangeOf(decl, ctx));
    }
  }
  return null;
}

function classifyFunctionDecl(node: SwcNode, range: Range, ctx: SpanContext): FunctionDecl {
  const rawName = node.identifier?.value;
  const name = typeof rawName === 'string' ? rawName : null;
  const params = (node.params ?? []).map((p) => paramIdentifier(p, ctx));
  const body = bodyToStatements(node.body, ctx);
  return { kind: 'FunctionDecl', range, name, body, params };
}

function classifyClassDecl(node: SwcNode, range: Range, ctx: SpanContext): ClassDecl {
  const rawName = node.identifier?.value;
  const name = typeof rawName === 'string' ? rawName : null;
  const members = (Array.isArray(node.body) ? node.body : []).map((m) => memberIdentifier(m, ctx));
  const decorators = (node.decorators ?? []).map((d) => decoratorIdentifier(d, ctx));
  // Class body itself is a list of ClassMember nodes — they are not Statements
  // in our union, but the visitor walks `members` for name-usage, so `body`
  // is intentionally empty.
  const body: readonly Statement[] = [];
  return { kind: 'ClassDecl', range, name, body, members, decorators };
}

function classifyVariableDecl(node: SwcNode, range: Range, ctx: SpanContext): VariableDecl {
  const declKind = (node.kind === 'let' || node.kind === 'var' ? node.kind : 'const') as
    | 'const'
    | 'let'
    | 'var';
  const declarations: readonly VariableDeclarator[] = (node.declarations ?? []).map((d) => ({
    name: declaratorName(d.id),
    range: rangeOfSpan(d.span, ctx),
  }));
  return { kind: 'VariableDecl', range, declKind, declarations };
}

function classifyTypeDecl(node: SwcNode, range: Range): TypeDecl {
  const name = nameValueOf(node.id?.value);
  return { kind: 'TypeDecl', range, name };
}

function classifyEnumDecl(node: SwcNode, range: Range, ctx: SpanContext): EnumDecl {
  const name = nameValueOf(node.id?.value);
  const members: readonly Identifier[] = (node.members ?? []).map((m) => {
    const memberRange = rangeOf(m, ctx);
    const value = nameValueOf(m.id?.value);
    return { kind: 'Identifier', range: memberRange, name: value };
  });
  return { kind: 'EnumDecl', range, name, members };
}

function classifyExpressionStatement(
  node: SwcNode,
  range: Range,
  ctx: SpanContext,
): ExpressionStatement {
  const expression =
    node.expression !== null && node.expression !== undefined
      ? classifyExpression(node.expression, ctx)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'ExpressionStatement', range, expression };
}

function classifyIf(node: SwcNode, range: Range, ctx: SpanContext): IfStatement {
  const body: Statement[] = [];
  if (node.consequent !== null && node.consequent !== undefined) {
    pushBranchStatement(node.consequent, ctx, body);
  }
  if (node.alternate !== null && node.alternate !== undefined) {
    pushBranchStatement(node.alternate, ctx, body);
  }
  return { kind: 'IfStatement', range, body };
}

function pushBranchStatement(
  raw: SwcNode | readonly SwcNode[],
  ctx: SpanContext,
  out: Statement[],
): void {
  if (Array.isArray(raw)) {
    for (const s of raw) out.push(classifyStatement(s, ctx));
  } else {
    out.push(classifyStatement(raw as SwcNode, ctx));
  }
}

function classifyFor(node: SwcNode, range: Range, ctx: SpanContext): ForStatement {
  const body: Statement[] = [];
  if (node.body !== null && node.body !== undefined) {
    pushBranchStatement(node.body, ctx, body);
  }
  return { kind: 'ForStatement', range, body };
}

function classifyWhile(node: SwcNode, range: Range, ctx: SpanContext): WhileStatement {
  const body: Statement[] = [];
  if (node.body !== null && node.body !== undefined) {
    pushBranchStatement(node.body, ctx, body);
  }
  return { kind: 'WhileStatement', range, body };
}

function classifySwitch(node: SwcNode, range: Range, ctx: SpanContext): SwitchStatement {
  const body: Statement[] = [];
  for (const c of node.cases ?? []) {
    for (const stmt of c.consequent) {
      body.push(classifyStatement(stmt, ctx));
    }
  }
  return { kind: 'SwitchStatement', range, body };
}

function classifyBlock(node: SwcNode, range: Range, ctx: SpanContext): BlockStatement {
  const stmts = node.stmts ?? (Array.isArray(node.body) ? (node.body as readonly SwcNode[]) : []);
  const body = stmts.map((s) => classifyStatement(s, ctx));
  return { kind: 'BlockStatement', range, body };
}

/**
 * Map an SWC expression-shaped node onto Fugazi's `Expression` union.
 * Unrecognised shapes collapse to `UnknownExpression`.
 *
 * Special case: SWC encodes `import('./x')`'s callee as `{ type: 'Import' }`
 * (NOT an Identifier). We translate that to an Identifier with name `'import'`
 * so downstream dynamic-import detection (Wave 5b-3 / T066) can pattern-match
 * uniformly.
 */
function classifyExpression(node: SwcNode, ctx: SpanContext): Expression {
  const range = rangeOf(node, ctx);
  switch (node.type) {
    case 'CallExpression': {
      const callee =
        node.callee !== null && node.callee !== undefined
          ? classifyExpression(node.callee, ctx)
          : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
      const args: readonly Expression[] = (node.arguments ?? []).map((a) =>
        classifyExpression(a.expression, ctx),
      );
      const out: CallExpression = { kind: 'CallExpression', range, callee, args };
      return out;
    }
    case 'NewExpression': {
      // `new Foo(a, b)` — args list mirrors CallExpression's `.arguments`.
      const callee =
        node.callee !== null && node.callee !== undefined
          ? classifyExpression(node.callee, ctx)
          : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
      const args: readonly Expression[] = (node.arguments ?? []).map((a) =>
        classifyExpression(a.expression, ctx),
      );
      const out: NewExpression = { kind: 'NewExpression', range, callee, args };
      return out;
    }
    case 'TemplateLiteral': {
      // `quasis` is a list of TemplateElement nodes carrying `.cooked` strings.
      // `expressions` is a list of inner SwcNodes for the `${...}` slots. The
      // invariant `quasis.length === expressions.length + 1` is guaranteed by
      // the JS template grammar; we coerce missing `cooked` (invalid escape)
      // to '' rather than null so consumers see uniform string segments.
      const quasis: readonly string[] = (node.quasis ?? []).map((q) =>
        typeof q.cooked === 'string' ? q.cooked : '',
      );
      const expressions: readonly Expression[] = (node.expressions ?? []).map((e) =>
        classifyExpression(e, ctx),
      );
      const out: TemplateLiteral = { kind: 'TemplateLiteral', range, quasis, expressions };
      return out;
    }
    case 'TaggedTemplateExpression': {
      // Best-effort: treat as a CallExpression whose callee is the tag and
      // whose single argument is the template. Reduces UnknownExpression
      // collapse for `sql\`select ...\`` and similar patterns. Downstream
      // consumers that care about the precise tagged-template shape can
      // distinguish via the args[0].kind === 'TemplateLiteral' check.
      const callee =
        node.tag !== null && node.tag !== undefined
          ? classifyExpression(node.tag, ctx)
          : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
      const tmpl =
        node.template !== null && node.template !== undefined
          ? classifyExpression(node.template, ctx)
          : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
      const out: CallExpression = {
        kind: 'CallExpression',
        range,
        callee,
        args: [tmpl],
      };
      return out;
    }
    case 'AwaitExpression':
    case 'YieldExpression': {
      // Pass-through: the visitor's walker can't see past these wrappers, so
      // `await import('./x')` and `yield foo()` would otherwise hide their
      // inner CallExpression behind UnknownExpression. Recurse into the
      // wrapped expression and adopt its classification (range stays the
      // wrapper's own — the inner expression already carries its own range
      // when reached via a child slot, but we don't expose a child slot for
      // the wrapper here).
      if (node.argument !== null && node.argument !== undefined) {
        return classifyExpression(node.argument, ctx);
      }
      const fallback: UnknownExpression = { kind: 'UnknownExpression', range };
      return fallback;
    }
    case 'Import': {
      // Dynamic-import callee — surface as a synthetic identifier.
      const out: Identifier = { kind: 'Identifier', range, name: 'import' };
      return out;
    }
    case 'Identifier': {
      const out: Identifier = { kind: 'Identifier', range, name: nameValueOf(node.value) };
      return out;
    }
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral': {
      const value = node.value ?? null;
      const out: Literal = { kind: 'Literal', range, value };
      return out;
    }
    case 'NullLiteral': {
      const out: Literal = { kind: 'Literal', range, value: null };
      return out;
    }
    case 'MemberExpression': {
      const object =
        node.object !== null && node.object !== undefined
          ? classifyExpression(node.object, ctx)
          : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
      const property = memberPropertyIdentifier(node.property ?? null, ctx);
      const out: MemberExpression = { kind: 'MemberExpression', range, object, property };
      return out;
    }
    case 'MetaProperty': {
      // SWC emits `import.meta` as a single MetaProperty node with
      // `kind: 'import.meta'`. Surface as our `ImportMeta` leaf.
      if (node.kind === 'import.meta') {
        const out: ImportMeta = { kind: 'ImportMeta', range };
        return out;
      }
      const fallback: UnknownExpression = { kind: 'UnknownExpression', range };
      return fallback;
    }
    case 'JSXElement': {
      const name = jsxElementName(node);
      const out: JSXElement = { kind: 'JSXElement', range, name };
      return out;
    }
    default: {
      const fallback: UnknownExpression = { kind: 'UnknownExpression', range };
      return fallback;
    }
  }
}

function jsxElementName(node: SwcNode): string {
  const opening = node.opening;
  if (opening === null || opening === undefined) return '';
  const named = opening.name;
  if (named === null || named === undefined) return '';
  if (named.type === 'Identifier') return nameValueOf(named.value);
  // JSXMemberExpression / JSXNamespacedName collapse to '' — tracking these
  // structurally is not required for current consumers.
  return '';
}

function memberPropertyIdentifier(node: SwcNode | null, ctx: SpanContext): Identifier {
  if (node === null) {
    return {
      kind: 'Identifier',
      name: '',
      range: {
        start: { line: 1, column: 0, byteOffset: 0 },
        end: { line: 1, column: 0, byteOffset: 0 },
      },
    };
  }
  const range = rangeOf(node, ctx);
  if (node.type === 'Identifier') {
    return { kind: 'Identifier', range, name: nameValueOf(node.value) };
  }
  // Computed property — name collapses to ''.
  return { kind: 'Identifier', range, name: '' };
}

function paramIdentifier(node: SwcNode, ctx: SpanContext): Identifier {
  // SWC's `Param` wraps the binding pattern in a `{ type: 'Parameter', pat: ... }`
  // shape on some grammar forms. We surface the bound name uniformly: an
  // Identifier pattern yields its `.value`; anything else collapses to ''.
  const range = rangeOf(node, ctx);
  const inner = (node as unknown as { pat?: SwcNode }).pat ?? node;
  if (inner.type === 'Identifier') {
    return { kind: 'Identifier', range, name: nameValueOf(inner.value) };
  }
  return { kind: 'Identifier', range, name: '' };
}

function memberIdentifier(node: SwcNode, ctx: SpanContext): Identifier {
  const range = rangeOf(node, ctx);
  const key = node.key;
  if (typeof key === 'string') return { kind: 'Identifier', range, name: key };
  if (key !== null && key !== undefined && key.type === 'Identifier') {
    return { kind: 'Identifier', range, name: nameValueOf(key.value) };
  }
  return { kind: 'Identifier', range, name: '' };
}

function decoratorIdentifier(node: SwcNode, ctx: SpanContext): Identifier {
  const range = rangeOf(node, ctx);
  // SWC decorator wraps its expression in `{ type: 'Decorator', expression: ... }`.
  const expr = (node as unknown as { expression?: SwcNode }).expression ?? node;
  if (expr.type === 'Identifier')
    return { kind: 'Identifier', range, name: nameValueOf(expr.value) };
  if (expr.type === 'CallExpression' && expr.callee?.type === 'Identifier') {
    return { kind: 'Identifier', range, name: nameValueOf(expr.callee.value) };
  }
  return { kind: 'Identifier', range, name: '' };
}

function declaratorName(idNode: SwcNode): string {
  if (idNode.type === 'Identifier') return nameValueOf(idNode.value);
  // Destructuring patterns collapse to ''. The visitor's pattern-flattening is
  // a future-wave concern; for unused-exports analysis the binding name comes
  // from the export alias, not the pattern.
  return '';
}

function bodyToStatements(
  body: SwcNode | readonly SwcNode[] | null | undefined,
  ctx: SpanContext,
): readonly Statement[] {
  if (body === null || body === undefined) return [];
  if (Array.isArray(body)) return body.map((s) => classifyStatement(s, ctx));
  const single = body as SwcNode;
  // Function bodies in SWC are BlockStatements with a `stmts` array.
  if (single.type === 'BlockStatement' && Array.isArray(single.stmts)) {
    return single.stmts.map((s) => classifyStatement(s, ctx));
  }
  return [classifyStatement(single, ctx)];
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
  const body = mod.body.map((n) => classifyStatement(n, ctx));
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
