/**
 * index.ts — Phase 3c.4 Dispatch B (T064) — single-pass inventory orchestrator.
 *
 * `buildInventory(program)` traverses the AST exactly once via the shared
 * `walk()` helper and returns three sorted, frozen collections:
 * declarations, imports, and usages. Helpers in `./declarations.ts`,
 * `./imports.ts`, and `./usages.ts` append to mutable accumulators owned here.
 *
 * Single-pass discipline (T063-test #1): there is exactly ONE call to
 * `walk()`. The walker invokes `onEnter` per node; the corresponding
 * `childrenOf`-recursion baseline yields the same count. The visitor never
 * iterates `program.body` outside the walker.
 *
 * Determinism (NFR-1 / SC-15): each output array is sorted by
 * `range.start.byteOffset` (then by `name`) and frozen. Two consecutive
 * `buildInventory` calls on the same `Program` produce byte-equal
 * `JSON.stringify(inventory)`.
 *
 * Export-flagging strategy: the parser adapter populates
 * `ExportDecl.declaration` for `export <decl-form>` and
 * `export default <function|class>` shapes (see `parsers/oxc.ts`
 * `exportWrappedDeclaration`). The visitor inspects the `parent` argument
 * passed by `walk()` — when a declaration's parent is `ExportDecl`, the
 * `exported` flag is set. No pre-scan, no parent stack — just the single
 * walker callback's `parent` parameter.
 *
 * Per IMP-DEBT-08: this file (and its sibling helpers) performs a single
 * typed pass over a discriminated-union AST rather than a string-sentinel
 * multi-pass visitor. The sentinel token never appears in source.
 */

import { matchAssetUrl } from '../asset-url.js';
import type { ASTNode, Program } from '../ast/kinds.js';
import { walk } from '../ast/visit.js';
import {
  handleClass,
  handleEnum,
  handleFunction,
  handleType,
  handleVariable,
} from './declarations.js';
import { handleDynamicImport, handleReExport, handleStaticImport } from './imports.js';
import type { Declaration, Import, Inventory, Usage } from './types.js';
import { handleDecorators, handleIdentifier, handleJSX } from './usages.js';

export type {
  Declaration,
  DeclarationKind,
  Import,
  ImportKind,
  Inventory,
  MemberDecoration,
  Usage,
  UsageKind,
} from './types.js';

interface BuildOptions {
  /** Test-only hook: invoked on every walker `onEnter` to verify single-pass discipline. */
  readonly onEnter?: (node: ASTNode, parent: ASTNode | null) => void;
}

export function buildInventory(program: Program, options?: BuildOptions): Inventory {
  const declarations: Declaration[] = [];
  const imports: Import[] = [];
  const usages: Usage[] = [];
  const onEnter = options?.onEnter;

  walk(program, {
    onEnter: (node, parent) => {
      if (onEnter !== undefined) onEnter(node, parent);
      switch (node.kind) {
        case 'FunctionDecl':
          handleFunction(node, parent, declarations);
          return;
        case 'ClassDecl':
          handleClass(node, parent, declarations);
          handleDecorators(node, usages);
          return;
        case 'VariableDecl':
          handleVariable(node, parent, declarations);
          return;
        case 'TypeDecl':
          handleType(node, parent, declarations);
          return;
        case 'EnumDecl':
          handleEnum(node, parent, declarations);
          return;
        case 'ImportDecl':
          handleStaticImport(node, imports);
          return;
        case 'ExportDecl':
          handleReExport(node, imports);
          return;
        case 'CallExpression':
          handleDynamicImport(node, imports);
          return;
        case 'NewExpression': {
          // Asset-URL pattern: `new URL(literal, import.meta.url)`. Pure
          // structural detector returns null for any non-matching shape.
          // Known limitation: variable initializers (`const u = new URL(...)`)
          // are not reached because the walker does not currently descend
          // into VariableDecl declarators. Expression-statement form is
          // reached normally. A future visitor pre-scan could close that gap.
          const match = matchAssetUrl(node);
          if (match !== null) {
            imports.push({
              kind: 'asset',
              source: match.source,
              resolvable: true,
              range: node.range,
            });
          }
          return;
        }
        case 'Identifier':
          handleIdentifier(node, parent, usages);
          return;
        case 'JSXElement':
          handleJSX(node, usages);
          return;
        default:
          return;
      }
    },
  });

  return Object.freeze({
    lang: 'ts',
    declarations: Object.freeze(sortBy(declarations)),
    imports: Object.freeze(sortBy(imports)),
    usages: Object.freeze(sortBy(usages)),
  }) satisfies Inventory;
}

interface Sortable {
  readonly range: { readonly start: { readonly byteOffset: number } };
  readonly name?: string;
  readonly source?: string;
}

function sortBy<T extends Sortable>(arr: T[]): T[] {
  return arr.slice().sort((a, b) => {
    const offsetDelta = a.range.start.byteOffset - b.range.start.byteOffset;
    if (offsetDelta !== 0) return offsetDelta;
    const aTie = a.name ?? a.source ?? '';
    const bTie = b.name ?? b.source ?? '';
    return aTie < bTie ? -1 : aTie > bTie ? 1 : 0;
  });
}
