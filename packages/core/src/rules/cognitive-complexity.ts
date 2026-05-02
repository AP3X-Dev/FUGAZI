/**
 * rules/cognitive-complexity.ts — Phase 3f.5 (T160).
 *
 * Emits one `CognitiveComplexityIssue` per `FunctionComplexity` whose
 * `cognitive` score strictly exceeds the configured threshold (default 15).
 * Threshold is read from `config.health?.cognitiveThreshold`.
 *
 * Verbatim message format:
 *   `cognitive-complexity: <fnName> has cognitive complexity <N> (threshold <T>)`
 *
 * Mirrors `complexity-hotspot` but reads the cognitive metric instead. Same
 * sort ordering: `(file, range.start.byteOffset, score)`. Same degrade-to-
 * no-emit behaviour when `ctx.complexity` is absent.
 */

import type { CognitiveComplexityIssue, DiscriminatedIssue, Range, Severity } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'cognitive-complexity' as const;
const DEFAULT_COGNITIVE_THRESHOLD = 15;

/** Build the rule with the resolved severity threaded through. */
export function createCognitiveComplexityRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const map = ctx.complexity;
    if (map === undefined || map.size === 0) return [];

    const threshold = readCognitiveThreshold(ctx.config);
    const out: CognitiveComplexityIssue[] = [];

    const sortedNodes = [...ctx.graph.files.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    for (const node of sortedNodes) {
      const fc = map.get(node.id);
      if (fc === undefined) continue;
      for (const fn of fc.functions) {
        if (fn.cognitive <= threshold) continue;
        out.push(
          Object.freeze({
            kind: RULE_KIND,
            severity,
            file: node.path,
            range: fn.range,
            score: fn.cognitive,
            message: `cognitive-complexity: ${fn.name} has cognitive complexity ${fn.cognitive} (threshold ${threshold})`,
          }) satisfies CognitiveComplexityIssue,
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

function readCognitiveThreshold(config: { readonly health?: unknown }): number {
  const health = config.health;
  if (health === undefined || health === null || typeof health !== 'object') {
    return DEFAULT_COGNITIVE_THRESHOLD;
  }
  const t = (health as { readonly cognitiveThreshold?: unknown }).cognitiveThreshold;
  if (typeof t === 'number' && Number.isFinite(t) && t >= 0) return t;
  return DEFAULT_COGNITIVE_THRESHOLD;
}

function byteOffsetOf(range: Range): number {
  return range.start.byteOffset;
}
