/**
 * registry.test.ts — Phase 3h.4 — registry shape assertions.
 *
 * Pins the closed 15-tool list (FR-K1) and the read-only invariant
 * (FR-K5 / IMP-SEC-07).
 */

import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, TOOL_NAMES, verifyRegistry } from '../tools/index.js';
import { isMutatingTool, isReadOnlyTool } from '../types.js';

describe('MCP tool registry', () => {
  it('advertises exactly the 15 expected tool names in canonical order', () => {
    expect(ALL_TOOLS.length).toBe(15);
    expect(ALL_TOOLS.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('TOOL_NAMES is a closed set of the 15 strings', () => {
    expect(TOOL_NAMES).toEqual([
      'analyze',
      'dead_code',
      'dupes',
      'health',
      'audit',
      'trace_file',
      'trace_export',
      'boundaries',
      'explain',
      'schema',
      'init',
      'coverage_setup',
      'fix_apply',
      'fix_dry_run',
      'runtime_report',
    ]);
  });

  it('verifyRegistry passes for the canonical registry', () => {
    expect(() => verifyRegistry()).not.toThrow();
  });

  it('exactly one mutating tool (fix_apply); the other 14 are read-only', () => {
    const mutating = ALL_TOOLS.filter(isMutatingTool);
    const readOnly = ALL_TOOLS.filter(isReadOnlyTool);
    expect(mutating).toHaveLength(1);
    expect(mutating[0]?.name).toBe('fix_apply');
    expect(readOnly).toHaveLength(14);
  });

  it('rejects a registry that lifts a different tool to mutating', () => {
    const broken = ALL_TOOLS.map((tool) =>
      tool.name === 'analyze' ? { ...tool, mode: 'mutate' as const } : tool,
    );
    expect(() => verifyRegistry(broken)).toThrow(/only fix_apply may mutate/);
  });

  it('rejects a registry with a duplicate name', () => {
    const dup = [...ALL_TOOLS, ALL_TOOLS[0]] as typeof ALL_TOOLS;
    expect(() => verifyRegistry(dup)).toThrow(/duplicate tool name|expected 15/);
  });

  it('rejects a short registry', () => {
    const short = ALL_TOOLS.slice(0, 14) as typeof ALL_TOOLS;
    expect(() => verifyRegistry(short)).toThrow(/expected 15 tools/);
  });
});
