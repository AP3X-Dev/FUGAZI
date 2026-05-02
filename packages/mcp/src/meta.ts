/**
 * meta.ts — Phase 3h.4 (T195) — `_meta` envelope helpers.
 *
 * Every MCP tool result wraps its payload via `wrapResult`/`wrapError` so the
 * 4-field `_meta` envelope (schemaVersion, correlationId, progress, tookMs)
 * is always present (FR-K3 / F5 / IMP-API-10).
 *
 * `correlationId` and `tookMs` are non-deterministic by design. `randomUUID`
 * and `performance.now` are sourced via injectable functions so tests can
 * pin them.
 */

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ToolMeta, ToolMetaProgressEntry, ToolResultErr, ToolResultOk } from './types.js';

export interface MetaSources {
  readonly now: () => number;
  readonly newId: () => string;
}

/** Default time/uuid sources — backed by `performance.now` and `randomUUID`. */
export const DEFAULT_META_SOURCES: MetaSources = Object.freeze({
  now: () => performance.now(),
  newId: () => randomUUID(),
});

export interface MetaHandle {
  readonly meta: ToolMeta;
}

/**
 * Open a meta-builder at the start of a tool call. The returned `finish`
 * captures `tookMs` against `now()` and frames the meta envelope. Progress
 * entries are accumulated via `recordProgress`.
 */
export function openMeta(sources: MetaSources = DEFAULT_META_SOURCES): {
  readonly correlationId: string;
  readonly recordProgress: (entry: ToolMetaProgressEntry) => void;
  readonly finish: () => ToolMeta;
} {
  const startedAt = sources.now();
  const correlationId = sources.newId();
  const progress: ToolMetaProgressEntry[] = [];
  return {
    correlationId,
    recordProgress(entry: ToolMetaProgressEntry): void {
      progress.push(entry);
    },
    finish(): ToolMeta {
      return Object.freeze({
        schemaVersion: 1 as const,
        correlationId,
        progress: Object.freeze([...progress]) as readonly ToolMetaProgressEntry[],
        tookMs: sources.now() - startedAt,
      });
    },
  };
}

/** Build a frozen meta envelope from a finished progress list. */
export function buildMeta(
  progress: readonly ToolMetaProgressEntry[],
  options?: {
    readonly correlationId?: string;
    readonly tookMs?: number;
    readonly sources?: MetaSources;
  },
): ToolMeta {
  const sources = options?.sources ?? DEFAULT_META_SOURCES;
  return Object.freeze({
    schemaVersion: 1 as const,
    correlationId: options?.correlationId ?? sources.newId(),
    progress: Object.freeze([...progress]) as readonly ToolMetaProgressEntry[],
    tookMs: options?.tookMs ?? 0,
  });
}

export function wrapResult<T>(data: T, meta: ToolMeta): ToolResultOk<T> {
  return Object.freeze({ data, _meta: meta }) satisfies ToolResultOk<T>;
}

export function wrapError(message: string, meta: ToolMeta): ToolResultErr {
  return Object.freeze({
    error: true as const,
    message,
    exit_code: 0 as const,
    _meta: meta,
  }) satisfies ToolResultErr;
}
