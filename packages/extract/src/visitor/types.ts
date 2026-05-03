/**
 * types.ts — Phase 3c.4 Dispatch B (T063) — visitor inventory shape.
 *
 * Public types produced by `buildInventory(program)` (TS) and the Phase 4a
 * Python visitor (T305). Three flat collections (declarations, imports,
 * usages) sorted by `range.start.byteOffset` (then by name) so byte-equal JSON
 * serialisation is guaranteed across runs (NFR-1).
 *
 * Per IMP-DEBT-08: every collection is an `Array` (insertion-ordered, no
 * `Map` / `Set`) and every property is `readonly`. The visitor never reaches
 * for the original Fallow Rust pipeline's string-sentinel pattern.
 *
 * Cross-language discriminator (Phase 4a T302): `Inventory.lang` is an
 * optional `'ts' | 'py'` tag. ABSENT is interpreted as `'ts'` by all
 * consumers, preserving backwards-compat for every pre-Phase-4 caller. The
 * Phase 4a Python visitor (T305) sets `lang: 'py'` on emit; the TS visitor
 * (`./index.ts`) explicitly sets `lang: 'ts'` for symmetry. Downstream graph
 * code branches on this tag where Python-specific resolution rules differ
 * from TS.
 */

import type { Range } from '@fugazi/types';

export type DeclarationKind = 'function' | 'class' | 'variable' | 'type' | 'enum' | 'css-class';

/**
 * Optional Python-only enrichments (Phase 4c T331 + T333). The TS visitor
 * never populates these fields. The Python visitor sets:
 *
 *   - `bases`      — base-class identifier names from `class X(Base1, Base2):`,
 *                    used by the rule layer to detect TypedDict / Protocol
 *                    / Generic subclasses without re-walking the AST.
 *   - `annotation` — the annotation expression text for `AnnAssign` targets,
 *                    used to detect `X: TypeAlias = ...` forms. Best-effort:
 *                    the visitor surfaces only the leading identifier (e.g.
 *                    `'TypeAlias'` for `X: TypeAlias = int`) since the full
 *                    expression is not preserved as a string in the AST.
 *   - `valueCallee` — when the assignment value is a Call (e.g.
 *                    `Foo = NewType('Foo', int)`), the callee identifier
 *                    name (`'NewType'`). `undefined` for non-call values.
 *   - `decoratedMembers` — names of class members (methods + attribute
 *                    declarations) that carry at least one decorator. Used
 *                    by `unused-class-members` to suppress framework-driven
 *                    invocations (e.g. `@app.route`, `@pytest.fixture`).
 *
 * All four fields stay `undefined` for TS and JS, preserving the historical
 * TS shape. Consumers that don't care simply ignore them.
 */
/**
 * Phase 4d T346 — per-member decorator metadata. Populated by the Python
 * visitor for class members carrying at least one decorator. Each entry
 * records the dotted decorator name(s) attached to the member, allowing
 * downstream rules to apply per-decorator allowlists (e.g. exempt only
 * `@app.route`-decorated methods rather than every decorated method).
 *
 * The list runs in source order — top-most decorator first, matching the
 * AST. Decorators with arguments are unwrapped at the visitor (`@dec(...)`
 * → `'dec'`), matching the `Usage{kind:'decorator'}` payload contract.
 */
export interface MemberDecoration {
  readonly name: string;
  readonly decorators: readonly string[];
}

export interface Declaration {
  readonly kind: DeclarationKind;
  readonly name: string;
  readonly exported: boolean;
  readonly range: Range;
  readonly members: readonly string[];
  readonly bases?: readonly string[];
  readonly annotation?: string;
  readonly valueCallee?: string;
  readonly decoratedMembers?: readonly string[];
  /**
   * Phase 4d T346. Per-member decorator names. Populated by the Python
   * visitor for class declarations whose members carry decorators. Empty
   * (`undefined`) for TS classes and for Python classes with no decorated
   * members. Each entry's `decorators` list mirrors the dotted form emitted
   * by `Usage{kind:'decorator'}` — `@app.route` → `'app.route'`, `@fixture`
   * → `'fixture'`. Used by `unused-class-members` to apply per-plugin
   * `usedDecorators` allowlists.
   */
  readonly memberDecorations?: readonly MemberDecoration[];
  /**
   * Phase 4f T381 — Python-only. The subset of `members` whose declaration
   * form is `AnnAssign` (annotated class attribute) — the canonical field
   * shape used by Pydantic (`class User(BaseModel): name: str`),
   * dataclasses (`@dataclass class User: name: str`), attrs, and
   * SQLAlchemy declarative bases. The `unused-class-members` rule treats
   * field-shaped members as framework-presumed-used: the field is
   * assigned via constructor kwargs (`User(name='x')`) or via ORM
   * column-binding, neither of which the static analyzer's literal
   * `.member` access pass can capture. Empty (`undefined`) for TS classes
   * and for Python classes with no annotated attributes. The list is
   * exhaustive — every name is also present in `members`; consumers
   * compute `methods = members \ fieldMembers` when they want only the
   * function-decl side.
   */
  readonly fieldMembers?: readonly string[];
}

export type ImportKind = 'static' | 'dynamic' | 'reexport' | 'asset' | 'type';

export interface Import {
  readonly kind: ImportKind;
  readonly source: string;
  readonly resolvable: boolean;
  readonly range: Range;
  /**
   * Phase 4f T381 — Python-only. The list of imported names from a
   * `from X import Y, Z` statement. Populated by the Python visitor for
   * every `ImportFromStmt`. Used by the graph builder to emit additional
   * edges for `X.Y` and `X.Z` when those resolve as submodule files —
   * Python's `from .pkg import sub` runs `pkg/__init__.py` first AND then
   * exposes `sub` as either a name in `__init__.py`'s namespace OR a
   * submodule file at `pkg/sub.py`. Without this, the analyzer flags the
   * submodule file as unused-files because the only edge points at the
   * package's `__init__.py`.
   *
   * The list excludes the `*` wildcard form (`from x import *` does NOT
   * populate `names`); it includes the unaliased binding name only —
   * `from x import a as b` records `'a'`, not `'b'`. The TS visitor never
   * sets this field; consumers reading TS imports treat its absence as
   * "no submodule promotion needed".
   */
  readonly names?: readonly string[];
}

export type UsageKind = 'identifier' | 'jsx' | 'member' | 'decorator' | 'css-class';

export interface Usage {
  readonly kind: UsageKind;
  readonly name: string;
  readonly range: Range;
}

/**
 * The inventory bundle handed back to graph + reporter consumers. `lang` is
 * optional for backwards-compat: any reader receiving `lang === undefined`
 * must treat the inventory as TS/JS. New callers should always emit it.
 */
export interface Inventory {
  readonly lang?: 'ts' | 'py';
  readonly declarations: readonly Declaration[];
  readonly imports: readonly Import[];
  readonly usages: readonly Usage[];
}
