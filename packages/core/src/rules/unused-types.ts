/**
 * rules/unused-types.ts — Phase 3f.2 Wave 1 (T140) + Phase 4c T331.
 *
 * Per-file type-export reachability. For TS, filtered to declarations whose
 * `kind === 'type'`. For Python, type-like declarations are detected by the
 * rule itself since the visitor emits TypedDict / Protocol subclasses as
 * `class-decl` and TypeAlias / NewType / PEP 695 `type` as `variable-decl`.
 *
 * Python detection (T331):
 *   - `class-decl` with a base in {`TypedDict`, `Protocol`} — type-like.
 *     `Generic[T]` is NOT type-like (it's a runtime generic class, just
 *     parameterised). The visitor surfaces `Generic` as a base name; the
 *     rule excludes it explicitly.
 *   - `variable-decl` whose `annotation === 'TypeAlias'` (PEP 613) or
 *     whose `valueCallee === 'NewType'` (PEP 484) or whose
 *     `valueCallee === 'TypeAliasType'` (PEP 695 desugaring). The PEP 695
 *     `type X = int` statement parses as an opaque statement in tree-sitter
 *     today; if the adapter ever surfaces it as a TypeAlias-Statement
 *     variant, this rule should add a branch. v1 detects PEP 695 only
 *     when the parser produces a `TypeAliasType(...)` desugar.
 *
 * KNOWN LIMITATION (deferred): the current Inventory does not expose
 * per-name resolved imports. As with unused-exports, this rule falls back to
 * a per-file consumer check — when a file has at least one incoming edge,
 * every type export on that file is treated as potentially used. Per-symbol
 * granularity requires visitor enrichment (ImportSpecifier names) and lands
 * in a later phase.
 *
 * When `entryPoints` is empty the rule emits nothing, matching the
 * unused-files / unused-exports early-return.
 */

import type { Declaration } from '@fugazi/extract';
import type { FileNode } from '@fugazi/graph';
import type { DiscriminatedIssue, Severity, UnusedTypesIssue } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'unused-types' as const;

/**
 * Python class bases that mark the class as a type-like declaration. A
 * class subclassing any of these is treated as a public type for unused-types.
 */
const PY_TYPE_BASE_MARKERS: ReadonlySet<string> = new Set(['TypedDict', 'Protocol']);

/**
 * Python annotation identifiers that mark the annotated variable as a type
 * alias (PEP 613 / explicit `: TypeAlias`). The visitor surfaces only the
 * leading identifier, so `typing.TypeAlias` and `typing_extensions.TypeAlias`
 * both reduce to `'TypeAlias'`.
 */
const PY_TYPE_ANNOTATION_MARKERS: ReadonlySet<string> = new Set(['TypeAlias']);

/**
 * Python call-expression callees that mark the assignment target as a
 * type-like declaration. `NewType('Foo', int)` (PEP 484), `TypeAliasType`
 * (PEP 695 desugaring), `TypeVar('T')` (treated as type-like for v1).
 */
const PY_TYPE_CALLEE_MARKERS: ReadonlySet<string> = new Set([
  'NewType',
  'TypeAliasType',
  'TypeVar',
  'ParamSpec',
  'TypeVarTuple',
]);

/**
 * Decide whether a Python `class-decl` or `variable-decl` should be treated
 * as a type-like declaration for unused-types. Returns false for TS
 * declarations (the visitor never sets `bases` / `annotation` /
 * `valueCallee` on TS shapes).
 */
function isPythonTypeLikeDecl(decl: Declaration): boolean {
  if (decl.kind === 'class') {
    if (decl.bases === undefined) return false;
    for (const base of decl.bases) {
      if (PY_TYPE_BASE_MARKERS.has(base)) return true;
    }
    return false;
  }
  if (decl.kind === 'variable') {
    if (decl.annotation !== undefined && PY_TYPE_ANNOTATION_MARKERS.has(decl.annotation)) {
      return true;
    }
    if (decl.valueCallee !== undefined && PY_TYPE_CALLEE_MARKERS.has(decl.valueCallee)) {
      return true;
    }
    return false;
  }
  return false;
}

function isPythonFile(path: string): boolean {
  return path.endsWith('.py');
}

export function createUnusedTypesRule(severity: Severity): RuleHandler {
  return (ctx) => {
    if (ctx.entryPoints.length === 0) return [];

    const entryPaths = new Set(ctx.entryPoints);
    const out: UnusedTypesIssue[] = [];

    const filesInPathOrder: FileNode[] = [...ctx.graph.files.values()];

    for (const node of filesInPathOrder) {
      if (entryPaths.has(node.path)) continue;
      const consumers = ctx.graph.edgesByTarget.get(node.id);
      if (consumers !== undefined && consumers.length > 0) continue;

      const isPy = isPythonFile(node.path) || node.inventory.lang === 'py';

      for (const decl of node.inventory.declarations) {
        if (!decl.exported) continue;
        const isTypeLike = isPy ? isPythonTypeLikeDecl(decl) : decl.kind === 'type';
        if (!isTypeLike) continue;
        out.push(
          Object.freeze({
            kind: RULE_KIND,
            severity,
            file: node.path,
            range: decl.range,
            typeName: decl.name,
            message: `unused-types: ${decl.name} in ${node.path} has no consumers`,
          }) satisfies UnusedTypesIssue,
        );
      }
    }
    return out as readonly DiscriminatedIssue[];
  };
}
