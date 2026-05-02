/**
 * validate.ts — Phase 3h.4 (T195) — Zod-schema validation wrapper.
 *
 * Tools advertise their input shape as a Zod schema (per IMP-API-10). Invalid
 * arguments do NOT throw — they map to a `ToolResultErr` envelope so the MCP
 * transport stays in the success path (FR-K4); the error lives in the
 * payload.
 */

import type { ZodType } from 'zod';
import { buildMeta } from './meta.js';
import type { ToolResult } from './types.js';

/**
 * Wrap a tool handler so the input is parsed against `schema` first. On
 * validation failure the wrapper synthesises a `{ error: true, ... }`
 * envelope with the canonical message prefix `Invalid args:`.
 */
export function withValidation<I, O>(
  schema: ZodType<I>,
  handler: (input: I) => Promise<ToolResult<O>>,
): (raw: unknown) => Promise<ToolResult<O>> {
  return async (raw: unknown): Promise<ToolResult<O>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return Object.freeze({
        error: true as const,
        message: `Invalid args: ${parsed.error.message}`,
        exit_code: 0 as const,
        _meta: buildMeta([]),
      });
    }
    return handler(parsed.data);
  };
}
