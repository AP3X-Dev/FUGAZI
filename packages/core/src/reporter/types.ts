/**
 * reporter/types.ts — Phase 3h.1 (T179-T180) — single Reporter interface.
 *
 * Per IMP-API-05, every output format Fugazi supports (human, human-plain,
 * JSON, SARIF, Compact, Markdown, Code Climate) implements the same
 * `Reporter` contract. The CLI driver, LSP diagnostic serializer, MCP
 * `_meta`-wrapped result, and Node-API consumer all walk this same
 * begin → emit* → end sequence — so swapping formats is a one-line factory
 * call (`selectReporter(format)`).
 *
 * 3h.1 ships the interface + stub implementations. Per-format text lands in
 * Phase 3j; the contract is what matters here.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import type { ProgressEvent, RunAnalysisResult } from '../types.js';

/**
 * `ReporterMeta` — metadata supplied to `Reporter.begin` at the start of a
 * run. Carries the analysis mode, target project root, schema version, and
 * tool version so format-specific headers (SARIF tool node, JSON schemaUrl)
 * can populate without touching the issue stream.
 */
export interface ReporterMeta {
  readonly mode: RunAnalysisResult['_meta']['mode'];
  readonly version: string;
  readonly projectRoot: string;
  readonly schemaUrl?: string;
  readonly determinismHash?: string;
}

/**
 * Single output-format contract. All seven format implementations
 * (human, human-plain, JSON, SARIF, Compact, Markdown, Code Climate) satisfy
 * this interface. Full implementations land in Phase 3j; for 3h.1 the stubs
 * conform to the contract but emit empty/placeholder output.
 *
 * Call sequence (enforced by the contract test):
 *   begin(meta) → (emit | emitProgress)* → end()
 *
 * The CLI driver, LSP serializer, MCP _meta packer, and Node-API consumer
 * all walk this same sequence — so swapping formats is a one-line factory
 * call (`selectReporter(format)`).
 */
export interface Reporter {
  /** Begin a run. Called exactly once. Subsequent begin calls throw. */
  begin(meta: ReporterMeta): void;
  /** Emit one diagnostic. Order is caller-defined (driver emits sorted). */
  emit(issue: DiscriminatedIssue): void;
  /** Emit a progress event. May be called zero or more times. */
  emitProgress(event: ProgressEvent): void;
  /**
   * End the run and return the final serialized payload. Called exactly
   * once. After end(), no further emit/emitProgress are accepted.
   *
   * Returns a string for text-oriented formats (human, JSON, SARIF, …) and
   * Buffer for binary-oriented formats (none in v1; the union is hedged).
   */
  end(): string | Buffer;
}

/**
 * Closed list of every output format Fugazi supports. New formats require
 * adding the discriminator here AND shipping a class in `./<format>.ts` that
 * extends `ReporterBase` AND registering in `selectReporter`.
 */
export type ReporterFormat =
  | 'human' // Human-readable colour terminal output (default).
  | 'human-plain' // Same content, no ANSI; emitted under no-color or pipes (per IMP-API-05).
  | 'json' // JSON object: { issues, runtime?, _meta }. Deterministic key order.
  | 'sarif' // SARIF 2.1.0. Used by GitHub code scanning.
  | 'compact' // One issue per line: `<file>:<line>:<col>:<severity>:<rule-id>:<message>`.
  | 'markdown' // Markdown report — friendly for PR comments and LLM consumption.
  | 'codeclimate'; // Code Climate JSON. Used by GitLab CI quality reports.
