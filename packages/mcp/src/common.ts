/**
 * common.ts — shared helpers used across the 15 tool definitions.
 *
 * Centralises:
 *   - The base Zod schema for any analysis-flavoured tool (projectRoot only).
 *   - The `runWithMeta` helper that opens a meta-builder, drives an analysis,
 *     captures progress events into the envelope, and frames the result.
 */

import type { ProgressEvent } from '@fugazi/core';
import { z } from 'zod';
import { type MetaSources, openMeta, wrapError, wrapResult } from './meta.js';
import type { ToolMetaProgressEntry, ToolResult } from './types.js';

/**
 * Common analysis-input shape: every dispatcher tool needs an absolute
 * project root. Optional fields are added by individual tools.
 */
export const BaseAnalysisArgs = z.object({
  projectRoot: z.string().min(1),
});

export type BaseAnalysisArgsT = z.infer<typeof BaseAnalysisArgs>;

/** Convert a `@fugazi/core` ProgressEvent to a meta-envelope progress entry. */
export function progressEntryFromEvent(event: ProgressEvent, t: number): ToolMetaProgressEntry {
  return Object.freeze({
    kind: event.kind,
    seq: event.seq,
    t,
  });
}

/**
 * Run a tool body with a meta envelope. The body receives a `recordProgress`
 * callback so it can stream `ProgressEvent`s from `runAnalysis`.
 */
export async function runWithMeta<T>(
  body: (record: (event: ProgressEvent) => void) => Promise<T>,
  options?: { readonly sources?: MetaSources },
): Promise<ToolResult<T>> {
  const meta = openMeta(options?.sources);
  try {
    const data = await body((event) => {
      meta.recordProgress(progressEntryFromEvent(event, 0));
    });
    return wrapResult<T>(data, meta.finish());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return wrapError(message, meta.finish());
  }
}
