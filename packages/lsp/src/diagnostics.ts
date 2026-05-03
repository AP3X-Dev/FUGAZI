/**
 * diagnostics.ts — Phase 3h.3 (T192) — issue → LSP Diagnostic converter +
 * 500ms per-URI debouncer.
 *
 * The converter translates a `DiscriminatedIssue` (1-based line, 0-based UTF-16
 * column per `@fugazi/types` Position) into an LSP `Diagnostic` (0-based line,
 * 0-based UTF-16 column). File-level issues without an explicit `range` collapse
 * to `(0,0)-(0,0)`.
 *
 * The debouncer is an explicit timer-per-URI map per FR-J2 — no third-party
 * debounce library. Three rapid edits within 100ms collapse to one analysis
 * dispatch; 500ms idle elapses, the registered callback fires.
 */

import type { DiscriminatedIssue, Range } from '@fugazi/types';
import { type Diagnostic, DiagnosticSeverity, type Range as LspRange } from 'vscode-languageserver';

/** Default debounce window — 500ms per FR-J2. */
export const DEBOUNCE_MS = 500;

/** The diagnostic source advertised in every published Diagnostic. */
export const DIAGNOSTIC_SOURCE = 'fugazi';

/**
 * Convert a `DiscriminatedIssue` to an LSP `Diagnostic`. Position semantics:
 *
 *   - Issue.range.start.line is 1-based; LSP wants 0-based → subtract 1.
 *   - Issue.range.start.column is 0-based UTF-16 (matches LSP) → passthrough.
 *   - File-level issues (no `range`) collapse to (0,0)-(0,0).
 */
export function issueToDiagnostic(issue: DiscriminatedIssue): Diagnostic {
  const range = toLspRange(issue.range);
  return {
    severity: issue.severity === 'warn' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    range,
    code: issue.kind,
    source: DIAGNOSTIC_SOURCE,
    message: issue.message,
  };
}

/**
 * Convert every issue for a given URI to a Diagnostic[]. Off-severity issues
 * are dropped — LSP doesn't carry an `off` representation.
 */
export function issuesToDiagnostics(issues: readonly DiscriminatedIssue[]): readonly Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const issue of issues) {
    if (issue.severity === 'off') continue;
    out.push(issueToDiagnostic(issue));
  }
  return out;
}

function toLspRange(range: Range | undefined): LspRange {
  if (range === undefined) {
    return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  }
  return {
    start: {
      line: Math.max(0, range.start.line - 1),
      character: Math.max(0, range.start.column),
    },
    end: {
      line: Math.max(0, range.end.line - 1),
      character: Math.max(0, range.end.column),
    },
  };
}

/**
 * Per-URI debouncer. Each `schedule(uri, fn)` call cancels any pending timer
 * for `uri` and schedules a fresh one. Three calls within `delayMs` collapse
 * to a single `fn` invocation.
 */
export class PerUriDebouncer {
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #delayMs: number;

  constructor(delayMs: number = DEBOUNCE_MS) {
    this.#delayMs = delayMs;
  }

  schedule(uri: string, fn: () => void | Promise<void>): void {
    const existing = this.#timers.get(uri);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const handle = setTimeout(() => {
      this.#timers.delete(uri);
      void fn();
    }, this.#delayMs);
    this.#timers.set(uri, handle);
  }

  cancel(uri: string): void {
    const existing = this.#timers.get(uri);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.#timers.delete(uri);
    }
  }

  cancelAll(): void {
    for (const handle of this.#timers.values()) clearTimeout(handle);
    this.#timers.clear();
  }

  /** Pending timer count — exposed for tests. */
  get pending(): number {
    return this.#timers.size;
  }
}

/**
 * Group issues by file path. Used when a single analysis run produces
 * diagnostics across many files — the LSP must publish one
 * `textDocument/publishDiagnostics` per URI.
 */
export function groupIssuesByFile(
  issues: readonly DiscriminatedIssue[],
): ReadonlyMap<string, readonly DiscriminatedIssue[]> {
  const out = new Map<string, DiscriminatedIssue[]>();
  for (const issue of issues) {
    const bucket = out.get(issue.file);
    if (bucket === undefined) {
      out.set(issue.file, [issue]);
    } else {
      bucket.push(issue);
    }
  }
  return out;
}
