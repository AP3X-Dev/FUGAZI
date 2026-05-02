/**
 * rules/complexity-hotspot.ts — Phase 3f.5 (T158).
 *
 * Emits one `ComplexityHotspotIssue` per `FunctionComplexity` whose
 * `cyclomatic` score strictly exceeds the configured threshold (default 10).
 * Threshold is read from `config.health?.cyclomaticThreshold`.
 *
 * Verbatim message format:
 *   `complexity-hotspot: <fnName> has cyclomatic complexity <N> (threshold <T>)`
 *
 * Output is sorted by `(file, range.start.byteOffset, score)` so callers see
 * a deterministic stream regardless of FileId iteration order.
 *
 * Degrades to no-emit when `ctx.complexity` is undefined (e.g. the LSP
 * `preBuiltGraph` fast-path) or when the per-file entry is missing.
 */

import type { ComplexityHotspotIssue, DiscriminatedIssue, Range, Severity } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'complexity-hotspot' as const;
const METRIC_CYCLOMATIC = 'cyclomatic' as const;
const DEFAULT_CYCLOMATIC_THRESHOLD = 10;

/** Build the rule with the resolved severity threaded through. */
export function createComplexityHotspotRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const map = ctx.complexity;
    if (map === undefined || map.size === 0) return [];

    const threshold = readCyclomaticThreshold(ctx.config);
    const out: ComplexityHotspotIssue[] = [];

    // Walk graph.files in path-sorted order for stable output.
    const sortedNodes = [...ctx.graph.files.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    for (const node of sortedNodes) {
      const fc = map.get(node.id);
      if (fc === undefined) continue;
      for (const fn of fc.functions) {
        if (fn.cyclomatic <= threshold) continue;
        out.push(
          Object.freeze({
            kind: RULE_KIND,
            severity,
            file: node.path,
            range: fn.range,
            score: fn.cyclomatic,
            metric: METRIC_CYCLOMATIC,
            message: `complexity-hotspot: ${fn.name} has cyclomatic complexity ${fn.cyclomatic} (threshold ${threshold})`,
          }) satisfies ComplexityHotspotIssue,
        );
      }
    }

    out.sort((a, b) => {
      if (a.file < b.file) return -1;
      if (a.file > b.file) return 1;
      const ao = byteOffsetOf(a.range);
      const bo = byteOffsetOf(b.range);
      if (ao !== bo) return ao - bo;
      if (a.score !== b.score) return a.score - b.score;
      return 0;
    });

    return out as readonly DiscriminatedIssue[];
  };
}

function readCyclomaticThreshold(config: { readonly health?: unknown }): number {
  const health = config.health;
  if (health === undefined || health === null || typeof health !== 'object') {
    return DEFAULT_CYCLOMATIC_THRESHOLD;
  }
  const t = (health as { readonly cyclomaticThreshold?: unknown }).cyclomaticThreshold;
  if (typeof t === 'number' && Number.isFinite(t) && t >= 0) return t;
  return DEFAULT_CYCLOMATIC_THRESHOLD;
}

function byteOffsetOf(range: Range): number {
  return range.start.byteOffset;
}
