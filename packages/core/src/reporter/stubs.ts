/**
 * reporter/stubs.ts — Phase 3h.1 (T179-T180) — placeholder Reporter
 * implementations for all seven output formats.
 *
 * Each stub conforms to the `Reporter` contract (begin → emit* → end) but
 * emits an empty/placeholder payload. Per-format text serialization lands in
 * Phase 3j; here we only enforce the call-ordering state machine and provide
 * a stable surface every consumer (CLI / LSP / MCP / Node-API) can wire
 * against today.
 *
 * Determinism (NFR-1): every `end()` payload is byte-equal across runs for
 * the same inputs. No `Date.now()` / `Math.random()`. Object-key order in
 * JSON-shaped stubs is stable (insertion order over a fixed key set).
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
abstract class StubReporterBase implements Reporter {
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

/**
 * Build the canonical JSON-shaped stub payload used by JSON / SARIF / Compact
 * / Markdown / Code Climate stubs. Stable key order; deterministic.
 */
function jsonStub(
  format: ReporterFormat,
  meta: ReporterMeta | undefined,
  issueCount: number,
  progressEventCount: number,
): string {
  const payload = {
    _format: format,
    _stub: true,
    _meta: meta ?? null,
    issueCount,
    progressEventCount,
  };
  return JSON.stringify(payload);
}

/** `human` — terminal output with ANSI colour. v1 stub returns a 1-liner. */
export class HumanReporter extends StubReporterBase {
  protected override readonly format: ReporterFormat = 'human';

  protected override serialize(): string {
    return `fugazi: ${this.issues.length} issues; ${this.events.length} progress events; format=human (stub)`;
  }
}

/** `human-plain` — same content, no ANSI; emitted under no-color or pipes. */
export class HumanPlainReporter extends StubReporterBase {
  protected override readonly format: ReporterFormat = 'human-plain';

  protected override serialize(): string {
    return `fugazi: ${this.issues.length} issues; ${this.events.length} progress events; format=human-plain (stub)`;
  }
}

/** `json` — `{ issues, runtime?, _meta }` with deterministic key order. */
export class JsonReporter extends StubReporterBase {
  protected override readonly format: ReporterFormat = 'json';

  protected override serialize(meta: ReporterMeta | undefined): string {
    return jsonStub('json', meta, this.issues.length, this.events.length);
  }
}

/** `sarif` — SARIF 2.1.0 used by GitHub code scanning. */
export class SarifReporter extends StubReporterBase {
  protected override readonly format: ReporterFormat = 'sarif';

  protected override serialize(meta: ReporterMeta | undefined): string {
    return jsonStub('sarif', meta, this.issues.length, this.events.length);
  }
}

/** `compact` — one issue per line: `<file>:<line>:<col>:<severity>:<rule-id>:<message>`. */
export class CompactReporter extends StubReporterBase {
  protected override readonly format: ReporterFormat = 'compact';

  protected override serialize(meta: ReporterMeta | undefined): string {
    return jsonStub('compact', meta, this.issues.length, this.events.length);
  }
}

/** `markdown` — friendly for PR comments and LLM consumption. */
export class MarkdownReporter extends StubReporterBase {
  protected override readonly format: ReporterFormat = 'markdown';

  protected override serialize(meta: ReporterMeta | undefined): string {
    return jsonStub('markdown', meta, this.issues.length, this.events.length);
  }
}

/** `codeclimate` — Code Climate JSON used by GitLab CI quality reports. */
export class CodeclimateReporter extends StubReporterBase {
  protected override readonly format: ReporterFormat = 'codeclimate';

  protected override serialize(meta: ReporterMeta | undefined): string {
    return jsonStub('codeclimate', meta, this.issues.length, this.events.length);
  }
}
