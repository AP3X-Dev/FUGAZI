/**
 * validate.test.ts — Phase 3h.4 — invalid args map to a validation envelope.
 *
 * Per FR-K4 the MCP transport always succeeds; errors are inside the
 * payload. The wrapper synthesises `{ error: true, exit_code: 0 }` with the
 * `Invalid args:` prefix and a `_meta` envelope.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { withValidation } from '../validate.js';

describe('withValidation', () => {
  it('returns an error envelope for invalid args without invoking the handler', async () => {
    const schema = z.object({ projectRoot: z.string().min(1) });
    let handlerCalled = false;
    const handler = async (): Promise<ToolResult<{ ok: true }>> => {
      handlerCalled = true;
      return {
        data: { ok: true } as const,
        _meta: { schemaVersion: 1, correlationId: 'x', progress: [], tookMs: 0 },
      };
    };

    const wrapped = withValidation(schema, handler);
    const result = await wrapped({ projectRoot: '' });
    expect(handlerCalled).toBe(false);
    expect(result.error).toBe(true);
    if (result.error === true) {
      expect(result.message.startsWith('Invalid args:')).toBe(true);
      expect(result.exit_code).toBe(0);
      expect(result._meta.schemaVersion).toBe(1);
    }
  });

  it('forwards to the handler when args parse cleanly', async () => {
    const schema = z.object({ projectRoot: z.string().min(1) });
    const handler = async (input: { projectRoot: string }): Promise<ToolResult<string>> => ({
      data: input.projectRoot,
      _meta: { schemaVersion: 1, correlationId: 'x', progress: [], tookMs: 0 },
    });

    const wrapped = withValidation(schema, handler);
    const result = await wrapped({ projectRoot: '/tmp' });
    expect(result.error).toBeFalsy();
    if (result.error !== true) {
      expect(result.data).toBe('/tmp');
    }
  });

  it('error envelope for entirely-missing args', async () => {
    const schema = z.object({ projectRoot: z.string() });
    const handler = async (): Promise<ToolResult<null>> => ({
      data: null,
      _meta: { schemaVersion: 1, correlationId: 'x', progress: [], tookMs: 0 },
    });
    const wrapped = withValidation(schema, handler);
    const result = await wrapped(undefined);
    expect(result.error).toBe(true);
  });
});
