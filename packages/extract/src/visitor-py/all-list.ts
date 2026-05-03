/**
 * all-list.ts — Phase 4a T306 — `__all__` extraction.
 *
 * Python's de-facto public-API marker: a module-level assignment of the form
 * `__all__ = [...]` (or `__all__ = (...)`) governs what `from module import *`
 * re-exports AND functions as the canonical exported-public-API surface for
 * tools like Fugazi.
 *
 * This module walks the top-level `PyProgram.body` (NOT nested) for an
 * `Assign` whose single target is the literal name `__all__` and whose value
 * is a `List` or `Tuple` of `Constant` string entries. The result is a frozen
 * `Set<string>` of declared names (or `null` when no statically resolvable
 * `__all__` is present).
 *
 * Resolvability rules (v1):
 *
 *   - `__all__ = ['a', 'b']`            → resolves to {'a', 'b'}
 *   - `__all__ = ('a', 'b')`            → resolves to {'a', 'b'}
 *   - `__all__ = []` / `__all__ = ()`   → resolves to ∅ (empty: nothing exported)
 *   - `__all__ = ['a'] + ['b']`         → unresolvable; treat as absent
 *   - `__all__ = X if cond else Y`      → unresolvable; treat as absent
 *   - `__all__` appears at non-module-level (inside `if`/`def`/...) → ignored
 *   - `__all__` re-bound multiple times at module level → LAST wins (matches
 *     Python's runtime evaluation order)
 *
 * Non-literal forms silently fall through to the underscore-heuristic. v1
 * deliberately does NOT warn — the heuristic is conservative and the use case
 * (concatenated lists for re-exports) is too common to flag.
 *
 * Interaction with `declarations.ts`: when `extractAllList(program)` returns
 * a non-null Set, the orchestrator (`./index.ts`) uses it to drive the
 * `exported` flag — a declaration is `exported: true` IFF its name appears in
 * the Set. When `null`, the existing underscore-heuristic in
 * `declarations.ts::isPublicName` continues to apply.
 *
 * Determinism (NFR-1): the returned Set's iteration order is the source-order
 * insertion order of the literal entries; downstream consumers compose the
 * Set without re-sorting. The walk over `program.body` is single-pass.
 */

import type { Constant, List, PyExpression, PyProgram, Tuple } from '../ast/kinds-py.js';

/**
 * Extract the resolvable `__all__` names from a Python module. Returns a
 * frozen `Set<string>` when a single statically-resolvable assignment is
 * found at module level, or `null` otherwise.
 *
 * The Set is intentionally returned (not an Array) to make membership-check
 * the natural call-site usage; callers that need ordered iteration can
 * `[...set]` directly.
 */
export function extractAllList(program: PyProgram): ReadonlySet<string> | null {
  let resolved: ReadonlySet<string> | null = null;
  for (const stmt of program.body) {
    if (stmt.kind !== 'Assign') continue;
    if (stmt.targets.length !== 1) continue;
    if (stmt.targets[0] !== '__all__') continue;
    // Last-wins: a later assignment fully replaces an earlier resolution.
    const next = readLiteralStringList(stmt.value);
    // `next === null` means non-literal — DOES still replace prior resolutions
    // because at runtime the final binding wins regardless of resolvability.
    resolved = next;
  }
  return resolved;
}

/**
 * Read a `List` or `Tuple` whose elements are all string `Constant`s. Returns
 * a frozen Set of the string values, or `null` if the value is not a literal
 * list / tuple of strings.
 */
function readLiteralStringList(value: PyExpression): ReadonlySet<string> | null {
  if (value.kind !== 'List' && value.kind !== 'Tuple') return null;
  const elements = readElements(value);
  const out = new Set<string>();
  for (const element of elements) {
    if (element.kind !== 'Constant') return null;
    if (typeof element.value !== 'string') return null;
    out.add(element.value);
  }
  return Object.freeze(out) as ReadonlySet<string>;
}

function readElements(value: List | Tuple): readonly PyExpression[] {
  return value.elements;
}

/**
 * Helper for `declarations.ts`: decide whether `name` is exported given a
 * resolved `__all__` set. When `allList === null`, fall back to the
 * underscore-heuristic (names not starting with `_` are public). When
 * `allList !== null`, ONLY names in the list are public (an empty list means
 * nothing is exported).
 *
 * Empty / dunder names always return `false` to keep the contract uniform
 * with the underscore branch.
 */
export function isExportedName(name: string, allList: ReadonlySet<string> | null): boolean {
  if (name === '') return false;
  if (allList !== null) return allList.has(name);
  return !name.startsWith('_');
}

/** Re-export the literal types so `Constant` callers don't need a separate import. */
export type { Constant, List, Tuple };
