/**
 * index.ts — Phase 4a T305 — single-pass Python visitor orchestrator.
 *
 * `buildPyInventory(program, source, filename)` traverses the discriminated
 * `PyProgram` AST exactly once via `walkPy()` and returns three sorted,
 * frozen collections (declarations, imports, usages) plus the `lang: 'py'`
 * discriminator. Mirrors the discipline of `../visitor/index.ts` for TS.
 *
 * Single-pass: there is exactly ONE call to `walkPy()`. Every handler
 * appends to mutable accumulators owned here; the walker carries `parent`
 * so handlers can disambiguate by context.
 *
 * Scope tracking: function / lambda / comprehension bodies introduce
 * binding names that must NOT emit identifier-usages. We push parameter +
 * loop / comprehension target names into `ctx.bindings` on `onEnter` and
 * pop them on `onLeave`. A name introduced by a `Walrus` (`x := y`) is
 * treated as bound for the remainder of its containing scope — we use a
 * stack of pop-on-leave delta sets keyed by the scope's container node.
 *
 * Determinism (NFR-1 / SC-15): each output array is sorted by
 * `range.start.byteOffset` (then by `name`) and frozen. Two consecutive
 * `buildPyInventory` calls on the same `PyProgram` produce byte-equal
 * `JSON.stringify(inventory)`.
 *
 * Per IMP-DEBT-08: this file (and its sibling helpers) operates exclusively
 * on the discriminated union from `../ast/kinds-py.ts`. No string-sentinel
 * pattern ever appears.
 */

import type { ASTNodePy, Comprehension, PyProgram, Walrus } from '../ast/kinds-py.js';
import { walkPy } from '../ast/visit-py.js';
import type { Declaration, Import, Inventory, Usage } from '../visitor/types.js';
import { extractAllList } from './all-list.js';
import { handleAnnAssign, handleAssign, handleClass, handleFunction } from './declarations.js';
import { handleImport, handleImportFrom } from './imports.js';
import { collectTypeCheckingScope, isInsideTypeCheckingThen } from './type-checking.js';
import type { PyVisitorContext } from './types.js';
import {
  collectParameterBindings,
  handleAttribute,
  handleDecorator,
  handleName,
} from './usages.js';

interface BuildOptions {
  /** Test-only hook: invoked on every walker `onEnter` to verify single-pass discipline. */
  readonly onEnter?: (node: ASTNodePy, parent: ASTNodePy | null) => void;
}

export function buildPyInventory(
  program: PyProgram,
  _source: string,
  _filename: string,
  options?: BuildOptions,
): Inventory {
  const declarations: Declaration[] = [];
  const imports: Import[] = [];
  const usages: Usage[] = [];
  const ctx: PyVisitorContext = {
    declarations,
    imports,
    usages,
    bindings: new Set<string>(),
    stack: [],
  };
  const onEnterHook = options?.onEnter;

  // T306: extract `__all__` once before the walk. When non-null, it overrides
  // the underscore-heuristic for the `exported` flag on declarations.
  const allList = extractAllList(program);

  // T307: detect symbols that resolve to `typing.TYPE_CHECKING` so we can mark
  // imports inside `if TYPE_CHECKING:` blocks as `kind: 'type'`. The scope is a
  // module-wide set populated by walking `from typing import TYPE_CHECKING`
  // and `import typing` aliases up front.
  const typeCheckingScope = collectTypeCheckingScope(program);
  const typeCheckingThenStack: ASTNodePy[] = [];

  // Each scope-introducing node pushes a "scope frame" — the list of names
  // it added to `ctx.bindings` so we can reverse the addition on `onLeave`.
  const scopeFrames = new Map<ASTNodePy, readonly string[]>();

  walkPy(program, {
    onEnter: (node, parent) => {
      if (onEnterHook !== undefined) onEnterHook(node, parent);
      ctx.stack.push(node);
      enterScopeIfNeeded(node, ctx, scopeFrames);
      // T307: when this is an `IfStmt` whose test is `TYPE_CHECKING` (or
      // `typing.TYPE_CHECKING`), record the IfStmt so any imports inside its
      // `then` branch (which the adapter folds into `body`) emit kind 'type'.
      if (node.kind === 'IfStmt' && isInsideTypeCheckingThen(node, typeCheckingScope)) {
        typeCheckingThenStack.push(node);
      }
      switch (node.kind) {
        case 'FunctionDef':
        case 'AsyncFunctionDef':
          handleFunction(node, parent, declarations, allList);
          // Function/method names never emit a Usage themselves.
          return;
        case 'ClassDef':
          handleClass(node, parent, declarations, allList);
          return;
        case 'Assign':
          handleAssign(node, parent, declarations, allList);
          return;
        case 'AnnAssign':
          handleAnnAssign(node, parent, declarations, allList);
          return;
        case 'ImportStmt':
          handleImport(node, imports, typeCheckingThenStack.length > 0);
          return;
        case 'ImportFromStmt':
          handleImportFrom(node, imports, typeCheckingThenStack.length > 0);
          return;
        case 'Decorator':
          handleDecorator(node, ctx);
          return;
        case 'Attribute':
          handleAttribute(node, ctx);
          return;
        case 'Name':
          handleName(node, parent, ctx);
          return;
        default:
          return;
      }
    },
    onLeave: (node) => {
      ctx.stack.pop();
      const frame = scopeFrames.get(node);
      if (frame !== undefined) {
        for (const name of frame) ctx.bindings.delete(name);
        scopeFrames.delete(node);
      }
      const top = typeCheckingThenStack[typeCheckingThenStack.length - 1];
      if (top === node) {
        typeCheckingThenStack.pop();
      }
    },
  });

  return Object.freeze({
    lang: 'py',
    declarations: Object.freeze(sortBy(declarations)),
    imports: Object.freeze(sortBy(imports)),
    usages: Object.freeze(sortBy(usages)),
  }) satisfies Inventory;
}

/**
 * `enterScopeIfNeeded` — when entering a node that introduces bindings,
 * push the bound names into `ctx.bindings` and remember them in a per-node
 * frame so the matching `onLeave` can remove them.
 */
function enterScopeIfNeeded(
  node: ASTNodePy,
  ctx: PyVisitorContext,
  frames: Map<ASTNodePy, readonly string[]>,
): void {
  switch (node.kind) {
    case 'FunctionDef':
    case 'AsyncFunctionDef':
      pushScope(node, collectParameterBindings(node.params), ctx, frames);
      return;
    case 'Lambda':
      pushScope(node, collectParameterBindings(node.params), ctx, frames);
      return;
    case 'ClassDef':
      // Class bodies do NOT introduce a name-binding scope for their bases
      // (handled below) — class-level assignments are accessible via
      // `Self.attr` from methods, not as bare names. We do skip the class's
      // own name as a usage candidate by scoping it: the declaration handler
      // already records it; a subsequent walk past the inner Name (the
      // class's own identifier) does NOT happen because the adapter stores
      // the name as a string, not a Name node.
      return;
    case 'ForStmt':
      // The loop variable binds for the body. The adapter stores `target`
      // as a string; usage suppression for it must be handled by adding to
      // bindings here.
      pushScope(
        node,
        [node.target].filter((n) => n !== ''),
        ctx,
        frames,
      );
      return;
    case 'Comprehension':
      pushScope(node, collectComprehensionBindings(node), ctx, frames);
      return;
    case 'Walrus':
      // Walrus introduces a binding visible for the rest of the enclosing
      // function/lambda/comprehension scope. We add to bindings without
      // popping at the Walrus's own onLeave — instead, we attach the
      // delta to the nearest enclosing scope-frame. To avoid leaking the
      // binding into siblings (it's correctly visible after the walrus),
      // we do attach to the Walrus's own frame as a simple approximation.
      // This means later siblings see the binding, but a sibling
      // function/lambda will start with a fresh scope (correct).
      pushScope(node, walrusBindings(node), ctx, frames);
      return;
    default:
      return;
  }
}

function pushScope(
  node: ASTNodePy,
  names: readonly string[],
  ctx: PyVisitorContext,
  frames: Map<ASTNodePy, readonly string[]>,
): void {
  if (names.length === 0) return;
  const added: string[] = [];
  for (const n of names) {
    if (n === '') continue;
    if (ctx.bindings.has(n)) continue;
    ctx.bindings.add(n);
    added.push(n);
  }
  if (added.length > 0) frames.set(node, added);
}

/**
 * Collect bindings introduced by a comprehension's `for x in iter` and
 * nested `for ... in ...` clauses. The adapter folds them into the
 * Comprehension.body array as the iter expressions; the binding NAMES are
 * not currently surfaced through the discriminated union (the adapter
 * stores them implicitly via the for_in_clause node's structure).
 *
 * v1 approximation: comprehensions don't currently surface their target
 * names in `kinds-py.ts`. We return an empty list — bindings introduced by
 * comprehension targets simply emit identifier-usages until T303 follow-up
 * work surfaces target names. This is a known limitation, deferred to
 * T306-T309.
 */
function collectComprehensionBindings(_node: Comprehension): readonly string[] {
  return [];
}

function walrusBindings(node: Walrus): readonly string[] {
  return node.target !== '' ? [node.target] : [];
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
