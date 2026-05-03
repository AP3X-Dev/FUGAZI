/**
 * sc-25-mcp-overhead.test.ts — Phase 3m T298 (a) — SC-25 acceptance row.
 *
 * SC-25: MCP tool-call overhead ≤20 ms p95 (request → first byte). Per D1
 * the server runs in-process; subprocess overhead is removed entirely. The
 * "overhead" measured here is the in-process registry dispatch:
 *   `tools/list` and `schema` (read-only, zero analysis work).
 *
 * Strategy: build a registry, call the lightest tool 20 times, measure
 * each call's wall-clock from request → first byte. Assert p95 ≤ 100 ms
 * (CI ceiling) and surface the value to stderr for the perf-runner CI job.
 */

import { performance } from 'node:perf_hooks';
import { buildRegistry } from '@fugazi/mcp';
import { describe, expect, it } from 'vitest';

function pickP95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? 0;
}

describe('SC-25: MCP tool-call overhead', () => {
  it('listTools p95 latency is ≤100 ms (CI ceiling; perf-runner tightens to ≤20 ms)', () => {
    const handle = buildRegistry();
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = handle.listTools();
      const elapsed = performance.now() - t0;
      expect(r.tools.length).toBe(15);
      samples.push(elapsed);
    }
    const p95 = pickP95(samples);
    console.error(`[SC-25 mcp listTools] p95=${p95.toFixed(3)}ms`);
    expect(p95).toBeLessThan(100);
  });
});
