/**
 * rules/unused-exports.ts — Phase 3f.2 Wave 1 (T138).
 *
 * Per-file exported-name reachability.
 *
 * For every FileNode in the graph, this rule emits one `unused-exports`
 * finding per non-type, non-css-class declaration whose `exported === true`
 * IFF the file has no incoming edges (`graph.edgesByTarget.get(fileId)` is
 * absent or empty) AND the file is NOT itself a declared entry point.
 *
 * KNOWN LIMITATION (deferred to a later phase): the current Inventory shape
 * does not expose per-name resolved imports — `Import.source` is the
 * specifier and the visitor doesn't yet capture the imported `ImportSpecifier`
 * names. Per-symbol consumer tracking therefore cannot be done in 3f.2; the
 * fallback used here ("file with at least one consumer ⇒ all exports are
 * potentially used") is intentionally conservative. A subsequent phase will
 * extend the visitor to capture import-specifier names and refine this rule
 * to per-symbol granularity.
 *
 * When `entryPoints` is empty the rule emits nothing — without roots, the
 * project has no notion of "consumed by". This matches the unused-files
 * early-return.
 */

import type { FileNode } from '@fugazi/graph';
import type { DiscriminatedIssue, Severity, UnusedExportsIssue } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'unused-exports' as const;

export function createUnusedExportsRule(severity: Severity): RuleHandler {
  return (ctx) => {
    if (ctx.entryPoints.length === 0) return [];

    const entryPaths = new Set(ctx.entryPoints);
    const out: UnusedExportsIssue[] = [];

    // Path-sorted iteration keeps emit order deterministic without a separate
    // post-sort step. graph.files preserves insertion order from the
    // path-sorted FileNode array passed to buildGraph.
    const filesInPathOrder: FileNode[] = [...ctx.graph.files.values()];

    for (const node of filesInPathOrder) {
      if (entryPaths.has(node.path)) continue;
      const consumers = ctx.graph.edgesByTarget.get(node.id);
      if (consumers !== undefined && consumers.length > 0) continue;

      for (const decl of node.inventory.declarations) {
        if (!decl.exported) continue;
        if (decl.kind === 'type') continue;
        if (decl.kind === 'css-class') continue;
        out.push(
          Object.freeze({
            kind: RULE_KIND,
            severity,
            file: node.path,
            range: decl.range,
            exportName: decl.name,
            message: `unused-exports: ${decl.name} in ${node.path} has no consumers`,
          }) satisfies UnusedExportsIssue,
        );
      }
    }
    return out as readonly DiscriminatedIssue[];
  };
}
