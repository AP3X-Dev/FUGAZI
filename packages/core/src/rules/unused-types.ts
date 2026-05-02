/**
 * rules/unused-types.ts — Phase 3f.2 Wave 1 (T140).
 *
 * Per-file type-export reachability. Same shape as unused-exports but
 * filtered to declarations whose `kind === 'type'`.
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

import type { FileNode } from '@fugazi/graph';
import type { DiscriminatedIssue, Severity, UnusedTypesIssue } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'unused-types' as const;

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

      for (const decl of node.inventory.declarations) {
        if (!decl.exported) continue;
        if (decl.kind !== 'type') continue;
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
