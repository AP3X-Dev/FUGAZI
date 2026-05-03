/**
 * sc-20-21.test.ts — Phase 3m T295 — SC-20 + SC-21 acceptance row.
 *
 *   - SC-20: Runtime-intelligence layer is free (no gate); returns hot-path,
 *            cold-code, runtime-weighted-health blocks for V8 + Istanbul
 *            inputs. Vitest `column: null` tolerated.
 *   - SC-21: MCP `runtime_report` ungated; every MCP tool result carries the
 *            `_meta` envelope (`schemaVersion`, `correlationId`, `progress`,
 *            `tookMs`).
 *
 * Detailed runtime tests live under `packages/core/src/runtime/__tests__/`.
 * The MCP envelope tests live under `packages/mcp/src/__tests__/meta-envelope.test.ts`.
 * This file is the SC ledger gate that confirms (a) the public APIs are
 * reachable and (b) the surface compiles end-to-end.
 */

import { emptyRuntimeReport, findColdCode, findHotPaths } from '@fugazi/core';
import { ALL_TOOLS, TOOL_NAMES, buildMeta, openMeta, verifyRegistry } from '@fugazi/mcp';
import { describe, expect, it } from 'vitest';

describe('SC-20: runtime-intelligence layer is free and returns the three blocks', () => {
  it('emptyRuntimeReport returns the canonical shape with all four blocks', () => {
    const report = emptyRuntimeReport();
    expect(report).toBeDefined();
    expect(report.schemaVersion).toBe(1);
    expect(Array.isArray(report.hotPaths)).toBe(true);
    expect(Array.isArray(report.coldCode)).toBe(true);
    expect(Array.isArray(report.coverageMissing)).toBe(true);
    expect(Array.isArray(report.weightedRefactorTargets)).toBe(true);
  });

  it('findHotPaths is exported (no license gate / paid tier branch)', () => {
    expect(typeof findHotPaths).toBe('function');
  });

  it('findColdCode is exported (no license gate / paid tier branch)', () => {
    expect(typeof findColdCode).toBe('function');
  });
});

describe('SC-21: MCP runtime_report ungated; _meta envelope on every result', () => {
  it('runtime_report is one of the 15 registered tools', () => {
    expect(TOOL_NAMES).toContain('runtime_report');
  });

  it('the MCP registry has exactly 15 tools and verifies cleanly', () => {
    expect(ALL_TOOLS.length).toBe(15);
    expect(() => verifyRegistry()).not.toThrow();
  });

  it('buildMeta produces the four-field envelope', () => {
    const meta = buildMeta([], { correlationId: 'test-id', tookMs: 1.5 });
    expect(meta.schemaVersion).toBe(1);
    expect(meta.correlationId).toBe('test-id');
    expect(meta.tookMs).toBe(1.5);
    expect(Array.isArray(meta.progress)).toBe(true);
  });

  it('openMeta records progress entries and returns a valid envelope', () => {
    const handle = openMeta({ now: () => 100, newId: () => 'x-id' });
    handle.recordProgress({ phase: 'discover', n: 1, total: 10 } as never);
    const meta = handle.finish();
    expect(meta.schemaVersion).toBe(1);
    expect(meta.correlationId).toBe('x-id');
    expect(meta.progress.length).toBe(1);
    // tookMs is derived from now() deltas; with a fixed clock the value is 0.
    expect(typeof meta.tookMs).toBe('number');
  });
});
