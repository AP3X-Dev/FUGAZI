/**
 * type-checking.ts — Phase 4a T307 — `if TYPE_CHECKING:` block awareness.
 *
 * In Python, imports inside `if TYPE_CHECKING: ...` blocks are evaluated only
 * by static type checkers (mypy, pyright); at runtime the symbol
 * `typing.TYPE_CHECKING` is `False` and the block is skipped. Fugazi treats
 * these imports as type-only — `Import.kind: 'type'` — so downstream rules
 * can distinguish runtime from type-only references.
 *
 * Detection happens in two parts:
 *
 *   1. `collectTypeCheckingScope(program)` — walk the module body once before
 *      the main visitor pass and surface every name that resolves to
 *      `typing.TYPE_CHECKING`. The set always contains `'TYPE_CHECKING'` (the
 *      bare name) when `from typing import TYPE_CHECKING` (or any non-aliased
 *      `from typing import ..., TYPE_CHECKING`) is present. Aliased forms
 *      (`from typing import TYPE_CHECKING as TC`) add the alias name. When
 *      `import typing` (or `import typing as t`) is present we also accept
 *      the qualified `typing.TYPE_CHECKING` / `t.TYPE_CHECKING` forms below.
 *
 *      The detection is conservative: it never reaches across module
 *      boundaries (per the prompt's "STOP on cross-file resolution" note).
 *      If the project does `from .compat import TYPE_CHECKING`, v1 will NOT
 *      treat it as the typing flag — that would require resolver integration
 *      and is deferred to Phase 4b.
 *
 *   2. `isInsideTypeCheckingThen(ifStmt, scope)` — given an `IfStmt` whose
 *      test is a recognised `TYPE_CHECKING` reference, return true so the
 *      visitor can mark imports inside as type-only.
 *
 * `else:` branch handling — the IfStmt union folds the THEN branch and the
 * ELSE branch into a single `body` array (per `kinds-py.ts`). For the
 * `if TYPE_CHECKING:` use case the ELSE branch is rare (and intended to hold
 * RUNTIME imports — `if TYPE_CHECKING: import X\nelse: from .stub import X`).
 * v1 detection treats the entire `body` as type-only, which is a known
 * limitation: ELSE-branch imports inside an `if TYPE_CHECKING` block are
 * incorrectly flagged as type-only. This is documented for v1; deferring a
 * proper else-branch split until the adapter surfaces the branch boundary.
 *
 * Determinism (NFR-1): the scope Set is built by linear scan of
 * `program.body` in declaration order; iteration of the resulting Set
 * occurs only via membership checks, never as a primary data path.
 */

import type {
  Attribute,
  IfStmt,
  ImportFromStmt,
  ImportStmt,
  Name,
  PyExpression,
  PyProgram,
} from '../ast/kinds-py.js';

/**
 * Symbols that resolve to `typing.TYPE_CHECKING` within this module.
 *
 * `bareNames` — names that, when used as a plain `Name` reference, evaluate
 * to the typing flag. Always includes `'TYPE_CHECKING'` when `from typing
 * import TYPE_CHECKING` is detected; includes the local alias when
 * `from typing import TYPE_CHECKING as <alias>` is detected.
 *
 * `qualifiedRoots` — module-binding names that, when used as `<name>.TYPE_CHECKING`,
 * resolve to the typing flag. Includes `'typing'` for plain `import typing`,
 * and the alias for `import typing as <alias>`.
 */
export interface TypeCheckingScope {
  readonly bareNames: ReadonlySet<string>;
  readonly qualifiedRoots: ReadonlySet<string>;
}

/**
 * Walk the module body once, surfacing every binding that introduces a
 * reference to `typing.TYPE_CHECKING`. Only top-level imports count — a
 * conditional import inside an `if/try` block does NOT register, matching
 * the conservative posture of v1.
 */
export function collectTypeCheckingScope(program: PyProgram): TypeCheckingScope {
  const bareNames = new Set<string>();
  const qualifiedRoots = new Set<string>();
  for (const stmt of program.body) {
    if (stmt.kind === 'ImportFromStmt') {
      collectFromTyping(stmt, bareNames);
    } else if (stmt.kind === 'ImportStmt') {
      collectImportTyping(stmt, qualifiedRoots);
    }
  }
  return {
    bareNames: Object.freeze(bareNames) as ReadonlySet<string>,
    qualifiedRoots: Object.freeze(qualifiedRoots) as ReadonlySet<string>,
  };
}

function collectFromTyping(stmt: ImportFromStmt, bareNames: Set<string>): void {
  // `from typing import ...` — only absolute `typing` (level=0) counts.
  if (stmt.level !== 0) return;
  if (stmt.module !== 'typing') return;
  for (const spec of stmt.names) {
    const parsed = parseFromName(spec);
    if (parsed.imported === 'TYPE_CHECKING') {
      bareNames.add(parsed.local);
    }
  }
}

function collectImportTyping(stmt: ImportStmt, qualifiedRoots: Set<string>): void {
  // `import typing` / `import typing as t` — surface the bound module name.
  for (const spec of stmt.names) {
    const parsed = parseImportSpec(spec);
    if (parsed.module === 'typing') {
      qualifiedRoots.add(parsed.alias ?? 'typing');
    }
  }
}

/**
 * Read back `<imported>` or `<imported> as <local>` from the adapter's
 * `names[]` encoding.
 */
function parseFromName(spec: string): { readonly imported: string; readonly local: string } {
  const idx = spec.indexOf(' as ');
  if (idx === -1) return { imported: spec, local: spec };
  return { imported: spec.slice(0, idx), local: spec.slice(idx + 4) };
}

/**
 * Read back `<dotted>` or `<dotted> as <alias>` from the adapter's `names[]`
 * encoding for `import x` / `import x as y`.
 */
function parseImportSpec(spec: string): { readonly module: string; readonly alias?: string } {
  const idx = spec.indexOf(' as ');
  if (idx === -1) return { module: spec };
  return { module: spec.slice(0, idx), alias: spec.slice(idx + 4) };
}

/**
 * Decide whether an `IfStmt`'s test is a TYPE_CHECKING reference under the
 * detected scope. Recognised forms:
 *
 *   if TYPE_CHECKING:        → bare Name, id in `scope.bareNames`
 *   if typing.TYPE_CHECKING: → Attribute, value=Name(id ∈ scope.qualifiedRoots),
 *                              attr === 'TYPE_CHECKING'
 *
 * Negation (`if not TYPE_CHECKING:`) does NOT match — the imports inside
 * such a block are runtime imports.
 */
export function isInsideTypeCheckingThen(node: IfStmt, scope: TypeCheckingScope): boolean {
  return matchesTypeCheckingExpr(node.test, scope);
}

function matchesTypeCheckingExpr(expr: PyExpression, scope: TypeCheckingScope): boolean {
  if (expr.kind === 'Name') {
    return matchesBareName(expr, scope);
  }
  if (expr.kind === 'Attribute') {
    return matchesQualified(expr, scope);
  }
  return false;
}

function matchesBareName(name: Name, scope: TypeCheckingScope): boolean {
  return scope.bareNames.has(name.id);
}

function matchesQualified(attr: Attribute, scope: TypeCheckingScope): boolean {
  if (attr.attr !== 'TYPE_CHECKING') return false;
  if (attr.value.kind !== 'Name') return false;
  return scope.qualifiedRoots.has(attr.value.id);
}
