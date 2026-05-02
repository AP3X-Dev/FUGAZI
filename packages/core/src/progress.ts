/**
 * progress.ts — Phase 3f.1 (T133-T134) — progress-event emitter.
 *
 * `ProgressEmitter` assigns a monotonic `seq` to every emitted event and
 * shields `runAnalysis()` from misbehaving listener callbacks (per IMP-OBS-04
 * — a throwing callback must NOT abort the analysis; the failure is recorded
 * via `globalWarnOnce` and emission continues).
 *
 * Determinism (NFR-1): seq starts at 0 and increments by 1 per emit; given the
 * same source ordering of `emit()` calls the produced `seq` sequence is
 * byte-identical across runs.
 */

import { globalWarnOnce } from '@fugazi/types';
import type { ProgressEvent } from './types.js';

/** Emission shape passed to `ProgressEmitter.emit()` — caller omits `seq`. */
export type ProgressEventBody =
  | Omit<Extract<ProgressEvent, { kind: 'discover.start' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'discover.done' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'extract.start' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'extract.progress' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'extract.done' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'graph.start' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'graph.done' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'analyze.start' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'analyze.progress' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'analyze.done' }>, 'seq'>
  | Omit<Extract<ProgressEvent, { kind: 'crossref.done' }>, 'seq'>;

export class ProgressEmitter {
  #seq = 0;
  readonly #listeners: readonly ((event: ProgressEvent) => void)[];
  readonly #collected: ProgressEvent[] = [];

  /**
   * Build an emitter wrapping zero or more listener callbacks. Callbacks fire
   * in the order supplied; one throwing callback never blocks the others.
   */
  constructor(...listeners: readonly (((event: ProgressEvent) => void) | undefined)[]) {
    const filtered: ((event: ProgressEvent) => void)[] = [];
    for (const listener of listeners) {
      if (listener !== undefined) filtered.push(listener);
    }
    this.#listeners = filtered;
  }

  /**
   * Emit one event. Assigns the next `seq`, appends the fully-shaped event to
   * the internal buffer, and notifies every listener. Listener throws are
   * caught and warned-once; the analysis pipeline never aborts on listener
   * failure (IMP-OBS-04).
   */
  emit(body: ProgressEventBody): ProgressEvent {
    const event = buildEvent(body, this.#seq);
    this.#seq += 1;
    this.#collected.push(event);
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        if (globalWarnOnce.warn(`progress callback threw: ${detail}`)) {
          // intentional console.error per biome `noConsole.allow: ['error']`.
          console.error(`[fugazi/core] progress callback threw: ${detail}`);
        }
      }
    }
    return event;
  }

  /**
   * Snapshot of all emitted events in `seq` order. The returned array is
   * frozen so callers cannot mutate the buffer; it is the same content the
   * driver places into `RunAnalysisResult.progressEvents`.
   */
  collected(): readonly ProgressEvent[] {
    return Object.freeze([...this.#collected]);
  }
}

/**
 * Stamp a `seq` onto a body. Each branch returns a fresh frozen object whose
 * fields match the corresponding `ProgressEvent` variant. The exhaustive
 * switch satisfies `verbatimModuleSyntax` + `exactOptionalPropertyTypes`
 * (no conditional spreads, no `undefined` field stamps).
 */
function buildEvent(body: ProgressEventBody, seq: number): ProgressEvent {
  switch (body.kind) {
    case 'discover.start':
      return Object.freeze({ kind: 'discover.start', seq });
    case 'discover.done':
      return Object.freeze({ kind: 'discover.done', seq, fileCount: body.fileCount });
    case 'extract.start':
      return Object.freeze({ kind: 'extract.start', seq, total: body.total });
    case 'extract.progress':
      return Object.freeze({
        kind: 'extract.progress',
        seq,
        n: body.n,
        total: body.total,
      });
    case 'extract.done':
      return Object.freeze({ kind: 'extract.done', seq });
    case 'graph.start':
      return Object.freeze({ kind: 'graph.start', seq });
    case 'graph.done':
      return Object.freeze({ kind: 'graph.done', seq, edgeCount: body.edgeCount });
    case 'analyze.start':
      return Object.freeze({ kind: 'analyze.start', seq, ruleCount: body.ruleCount });
    case 'analyze.progress':
      return Object.freeze({
        kind: 'analyze.progress',
        seq,
        rule: body.rule,
        n: body.n,
        total: body.total,
      });
    case 'analyze.done':
      return Object.freeze({ kind: 'analyze.done', seq });
    case 'crossref.done':
      return Object.freeze({ kind: 'crossref.done', seq });
  }
}
