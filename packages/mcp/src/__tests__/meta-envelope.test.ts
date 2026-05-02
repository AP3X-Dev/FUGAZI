/**
 * meta-envelope.test.ts — Phase 3h.4 — every tool result includes the 4-field
 * `_meta` envelope (FR-K3 / F5 / IMP-API-10).
 *
 * Stub tools (coverage_setup, fix_apply) emit error envelopes; init writes a
 * file and refuses overwrite without `force`. To exercise every tool without
 * needing a project root we drive each through `withValidation` against
 * intentionally-invalid args — that path always returns a meta envelope and
 * never touches disk or the analysis driver.
 */

import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, TOOL_NAMES } from '../tools/index.js';
import { withValidation } from '../validate.js';

describe('_meta envelope', () => {
  it('every tool returns a result with all four meta fields when args are invalid', async () => {
    expect(ALL_TOOLS.length).toBe(TOOL_NAMES.length);
    for (const tool of ALL_TOOLS) {
      const wrapped = withValidation(tool.schema, tool.handler);
      // null is not a valid `z.object` input → forces the validation path,
      // which always emits a meta envelope.
      const result = await wrapped(null);
      expect(result.error, `${tool.name} should error on null args`).toBe(true);
      expect(result._meta).toBeDefined();
      expect(result._meta.schemaVersion).toBe(1);
      expect(typeof result._meta.correlationId).toBe('string');
      expect(result._meta.correlationId.length).toBeGreaterThan(0);
      expect(Array.isArray(result._meta.progress)).toBe(true);
      expect(typeof result._meta.tookMs).toBe('number');
    }
  });

  it('coverage_setup stub returns the verbatim not-implemented error envelope', async () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'coverage_setup');
    expect(tool).toBeDefined();
    if (tool === undefined) return;
    const wrapped = withValidation(tool.schema, tool.handler);
    const result = await wrapped({ projectRoot: '/tmp' });
    expect(result.error).toBe(true);
    if (result.error === true) {
      expect(result.message).toBe('coverage_setup: not implemented yet (Phase 3h.6)');
      expect(result.exit_code).toBe(0);
      expect(result._meta.schemaVersion).toBe(1);
    }
  });

  it('fix_apply stub returns the verbatim not-implemented error envelope', async () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'fix_apply');
    expect(tool).toBeDefined();
    if (tool === undefined) return;
    const wrapped = withValidation(tool.schema, tool.handler);
    const result = await wrapped({ projectRoot: '/tmp' });
    expect(result.error).toBe(true);
    if (result.error === true) {
      expect(result.message).toBe('fix_apply: not implemented yet (Phase 3h.6)');
      expect(result.exit_code).toBe(0);
    }
  });

  it('fix_dry_run stub returns an empty edit list with the v1 note', async () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'fix_dry_run');
    expect(tool).toBeDefined();
    if (tool === undefined) return;
    const wrapped = withValidation(tool.schema, tool.handler);
    const result = await wrapped({ projectRoot: '/tmp' });
    expect(result.error).toBeFalsy();
    if (result.error !== true) {
      const data = result.data as { readonly edits: unknown[]; readonly note: string };
      expect(data.edits).toEqual([]);
      expect(data.note).toBe('fix_dry_run: edit computation lands in Phase 3h.6');
    }
  });
});
