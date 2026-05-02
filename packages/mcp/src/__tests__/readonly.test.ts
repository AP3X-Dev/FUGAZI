/**
 * readonly.test.ts — Phase 3h.4 — type-level + runtime invariant.
 *
 * Type-level: a `MutatingTool` is structurally incompatible with a
 * `ReadOnlyTool` because the brand symbols are unique. The TypeScript
 * compile-time check below would error if the brand were stripped.
 *
 * Runtime: every tool other than `fix_apply` carries `mode === 'read'`.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ALL_TOOLS } from '../tools/index.js';
import {
  type AnyMutatingTool,
  type AnyReadOnlyTool,
  defineMutatingTool,
  defineReadOnlyTool,
} from '../types.js';

describe('read-only invariant', () => {
  it('only fix_apply has mode=mutate at runtime', () => {
    for (const tool of ALL_TOOLS) {
      if (tool.name === 'fix_apply') {
        expect(tool.mode).toBe('mutate');
      } else {
        expect(tool.mode).toBe('read');
      }
    }
  });

  it('type-level: a ReadOnlyTool variable cannot accept a MutatingTool', () => {
    // Compile-time check encoded as a runtime no-op. If the brand were
    // erased the line `const ro: AnyReadOnlyTool = mut;` would compile —
    // and tsc --noEmit would flag this test as a type error otherwise.
    const ro: AnyReadOnlyTool = defineReadOnlyTool({
      name: 'sample_ro',
      description: 'sample',
      schema: z.object({}),
      handler: async () => ({
        data: 1,
        _meta: { schemaVersion: 1, correlationId: 'x', progress: [], tookMs: 0 },
      }),
    });
    const mut: AnyMutatingTool = defineMutatingTool({
      name: 'sample_mut',
      description: 'sample',
      schema: z.object({}),
      handler: async () => ({
        data: 1,
        _meta: { schemaVersion: 1, correlationId: 'x', progress: [], tookMs: 0 },
      }),
    });

    // @ts-expect-error — branded types are structurally incompatible.
    const _bad: AnyReadOnlyTool = mut;
    void _bad;

    expect(ro.mode).toBe('read');
    expect(mut.mode).toBe('mutate');
  });
});
