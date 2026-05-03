/**
 * reporter/base.ts — Phase 3j — shared `ReporterBase` state machine.
 *
 * Every Fugazi reporter (human, human-plain, JSON, SARIF, Compact, Markdown,
 * Code Climate) extends this base class. The base owns the begin/emit/
 * emitProgress/end state machine; subclasses override `serialize(meta)` to
 * produce the format-specific payload.
 *
 * Per NFR-1 (determinism), nothing in the base reads `Date.now()`,
 * `Math.random()`, or any non-deterministic source. Subclasses must do the
 * same — they receive only `meta`, the recorded issue list, and the recorded
 * progress events.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import type { ProgressEvent } from '../types.js';
import type { Reporter, ReporterFormat, ReporterMeta } from './types.js';

/** Internal state-machine phase for the contract. */
type ReporterState = 'pending' | 'begun' | 'ended';

/**
 * Shared base implementing the begin/emit/emitProgress/end state machine.
 * Subclasses override `serialize()` to produce the format-specific payload.
 */
export abstract class ReporterBase implements Reporter {
  protected abstract readonly format: ReporterFormat;
  #state: ReporterState = 'pending';
  #meta: ReporterMeta | undefined;
  protected readonly issues: DiscriminatedIssue[] = [];
  protected readonly events: ProgressEvent[] = [];

  begin(meta: ReporterMeta): void {
    if (this.#state !== 'pending') {
      throw new Error('reporter: begin called twice');
    }
    this.#meta = meta;
    this.#state = 'begun';
  }

  /**
   * Phase 4e (T369): merge post-analysis metrics into the recorded `meta`.
   * Called by the driver after `runAnalysis` resolves so per-language file
   * counts and parse-error summaries are available to `serialize`. Safe to
   * invoke multiple times — last write wins. Throws if called outside the
   * begin → end window so misuse surfaces deterministically.
   */
  updateMeta(patch: Partial<ReporterMeta>): void {
    if (this.#state !== 'begun') {
      throw new Error('reporter: updateMeta called out of sequence');
    }
    if (this.#meta === undefined) return;
    this.#meta = { ...this.#meta, ...patch };
  }

  emit(issue: DiscriminatedIssue): void {
    if (this.#state === 'pending') {
      throw new Error('reporter: emit called before begin');
    }
    if (this.#state === 'ended') {
      throw new Error('reporter: emit called after end');
    }
    this.issues.push(issue);
  }

  emitProgress(event: ProgressEvent): void {
    if (this.#state === 'pending') {
      throw new Error('reporter: emitProgress called before begin');
    }
    if (this.#state === 'ended') {
      throw new Error('reporter: emitProgress called after end');
    }
    this.events.push(event);
  }

  end(): string | Buffer {
    if (this.#state !== 'begun') {
      throw new Error('reporter: end called out of sequence');
    }
    this.#state = 'ended';
    return this.serialize(this.#meta);
  }

  protected abstract serialize(meta: ReporterMeta | undefined): string | Buffer;
}
