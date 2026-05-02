/**
 * args-snapshot.test.ts — Phase 3h.4 — JSON-Schema snapshot for every tool's
 * input. Pins the surface so an accidental schema break is visible in PR.
 *
 * Snapshots use `expect(...).toMatchInlineSnapshot()` so the expected shape
 * lives next to the assertion (no separate fixture file).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ALL_TOOLS } from '../tools/index.js';

function schemaJsonFor(name: string): unknown {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return z.toJSONSchema(tool.schema);
}

describe('tool args JSON schemas', () => {
  it('analyze', () => {
    expect(schemaJsonFor('analyze')).toMatchSnapshot();
  });
  it('dead_code', () => {
    expect(schemaJsonFor('dead_code')).toMatchSnapshot();
  });
  it('dupes', () => {
    expect(schemaJsonFor('dupes')).toMatchSnapshot();
  });
  it('health', () => {
    expect(schemaJsonFor('health')).toMatchSnapshot();
  });
  it('audit', () => {
    expect(schemaJsonFor('audit')).toMatchSnapshot();
  });
  it('trace_file', () => {
    expect(schemaJsonFor('trace_file')).toMatchSnapshot();
  });
  it('trace_export', () => {
    expect(schemaJsonFor('trace_export')).toMatchSnapshot();
  });
  it('boundaries', () => {
    expect(schemaJsonFor('boundaries')).toMatchSnapshot();
  });
  it('explain', () => {
    expect(schemaJsonFor('explain')).toMatchSnapshot();
  });
  it('schema', () => {
    expect(schemaJsonFor('schema')).toMatchSnapshot();
  });
  it('init', () => {
    expect(schemaJsonFor('init')).toMatchSnapshot();
  });
  it('coverage_setup', () => {
    expect(schemaJsonFor('coverage_setup')).toMatchSnapshot();
  });
  it('fix_apply', () => {
    expect(schemaJsonFor('fix_apply')).toMatchSnapshot();
  });
  it('fix_dry_run', () => {
    expect(schemaJsonFor('fix_dry_run')).toMatchSnapshot();
  });
  it('runtime_report', () => {
    expect(schemaJsonFor('runtime_report')).toMatchSnapshot();
  });
});
