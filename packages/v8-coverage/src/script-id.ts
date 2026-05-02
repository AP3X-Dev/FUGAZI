/**
 * script-id.ts — Phase 3e (T112-T113) — URL-disambiguated script merging.
 *
 * V8 / Node coverage dumps from multi-worker runs commonly emit several
 * ScriptCoverage entries with overlapping `scriptId`s but distinct `url`s.
 * Conversely, the SAME url may appear across multiple workers; we then need
 * to merge the entries.
 *
 * Behavior:
 *   - Key: `url` when present and non-empty, else `script:${scriptId}` so
 *     missing-URL entries don't collide with each other or with URLs.
 *   - On collision (same key), MERGE: union the function arrays. Within a
 *     function (matched by `functionName`), union ranges (deduped by
 *     start/end) and sum counts where ranges overlap exactly.
 *     `isBlockCoverage` is taken from the FIRST-SEEN entry (deterministic).
 *   - Output array is sorted by URL ascending, ties broken by scriptId.
 *
 * Sort uses bare `<`/`>` per NFR-1 / SC-15 (no `localeCompare`).
 */

import type { CoverageInput, CoverageRange, FunctionCoverage, ScriptCoverage } from './types.js';

function keyOf(s: ScriptCoverage): string {
  return s.url.length > 0 ? s.url : `script:${s.scriptId}`;
}

function rangeKey(r: CoverageRange): string {
  return `${r.startOffset}:${r.endOffset}`;
}

function mergeFunctions(
  a: readonly FunctionCoverage[],
  b: readonly FunctionCoverage[],
): FunctionCoverage[] {
  // Group by functionName. To keep determinism, preserve first-seen order from
  // `a`, then append new names from `b`.
  const order: string[] = [];
  const byName = new Map<string, FunctionCoverage[]>();
  for (const fn of a) {
    if (!byName.has(fn.functionName)) {
      order.push(fn.functionName);
      byName.set(fn.functionName, []);
    }
    byName.get(fn.functionName)?.push(fn);
  }
  for (const fn of b) {
    if (!byName.has(fn.functionName)) {
      order.push(fn.functionName);
      byName.set(fn.functionName, []);
    }
    byName.get(fn.functionName)?.push(fn);
  }
  const out: FunctionCoverage[] = [];
  for (const name of order) {
    const group = byName.get(name) ?? [];
    if (group.length === 0) continue;
    // Merge ranges across the group. Same start:end → sum counts. First-seen
    // isBlockCoverage wins.
    const rangeOrder: string[] = [];
    const rangesByKey = new Map<string, CoverageRange>();
    for (const fn of group) {
      for (const r of fn.ranges) {
        const k = rangeKey(r);
        const existing = rangesByKey.get(k);
        if (existing === undefined) {
          rangeOrder.push(k);
          rangesByKey.set(k, r);
        } else {
          rangesByKey.set(k, {
            startOffset: existing.startOffset,
            endOffset: existing.endOffset,
            count: existing.count + r.count,
          });
        }
      }
    }
    // Sort merged ranges by startOffset asc, then endOffset asc — deterministic.
    const merged: CoverageRange[] = rangeOrder.map((k) => {
      const v = rangesByKey.get(k);
      if (v === undefined) {
        // Should be unreachable because rangeOrder is built only when set.
        return { startOffset: 0, endOffset: 0, count: 0 };
      }
      return v;
    });
    merged.sort((x, y) => {
      if (x.startOffset < y.startOffset) return -1;
      if (x.startOffset > y.startOffset) return 1;
      if (x.endOffset < y.endOffset) return -1;
      if (x.endOffset > y.endOffset) return 1;
      return 0;
    });
    const firstWithBlock = group[0];
    out.push({
      functionName: name,
      ranges: merged,
      isBlockCoverage: firstWithBlock?.isBlockCoverage ?? false,
    });
  }
  return out;
}

function mergeScripts(a: ScriptCoverage, b: ScriptCoverage): ScriptCoverage {
  return {
    // First-seen scriptId is preserved.
    scriptId: a.scriptId,
    url: a.url.length > 0 ? a.url : b.url,
    functions: mergeFunctions(a.functions, b.functions),
  };
}

export function disambiguateScripts(coverage: CoverageInput): readonly ScriptCoverage[] {
  // Preserve first-seen key order so merge is deterministic.
  const order: string[] = [];
  const byKey = new Map<string, ScriptCoverage>();
  for (const s of coverage.result) {
    const k = keyOf(s);
    const existing = byKey.get(k);
    if (existing === undefined) {
      order.push(k);
      byKey.set(k, s);
    } else {
      byKey.set(k, mergeScripts(existing, s));
    }
  }
  const collapsed: ScriptCoverage[] = order.map((k) => {
    const v = byKey.get(k);
    if (v === undefined) {
      return { scriptId: '', url: '', functions: [] };
    }
    return v;
  });
  collapsed.sort((x, y) => {
    if (x.url < y.url) return -1;
    if (x.url > y.url) return 1;
    if (x.scriptId < y.scriptId) return -1;
    if (x.scriptId > y.scriptId) return 1;
    return 0;
  });
  return collapsed;
}
