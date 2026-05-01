/**
 * scan.ts — Wave 5b-4 fail-soft `scanFile()` wrapper + `ScanErrorAggregator`.
 *
 * `scanFile` is the layer above `parse()` that the orchestrator will call once
 * per discovered source file. Contract:
 *   - Recognise the file's extension. If not in `recognizedExtensions`, return
 *     `{ ast: null, errors: [unsupported_language] }` WITHOUT touching the
 *     parser (so the caller never trips the WASM integrity check on a file we
 *     don't intend to parse).
 *   - Otherwise dispatch to `parse(source, { filename, lang })`.
 *   - Map each `ParseError` 1:1 onto a `ParseFailedScanError`.
 *   - WASM integrity / missing errors PROPAGATE — they are configuration
 *     failures, not per-file `ScanError`s. Phase 3d's orchestrator handles
 *     them at a higher level.
 *
 * The IO branch of `ScanError` is currently UNREACHABLE here (source is passed
 * in as a string, never read from disk). The branch exists in the union for
 * Phase 3d when `scanPath(path)` lands. Tests cover the union shape by
 * constructing `IoScanError` instances directly.
 *
 * `ScanErrorAggregator` is the orchestrator's drain API: call `add()` /
 * `addMany()` during a walk, then `drain()` at end-of-phase to obtain a
 * deterministically-sorted snapshot. `drain()` does NOT clear internal state
 * — repeated calls return equal arrays.
 */

import {
  type ParseFailedScanError,
  type ScanError,
  unsupportedLanguageMessage,
} from '../scan-error.js';
import { parse } from './oxc.js';
import type { Program } from './oxc.js';
import type { Language } from './types.js';

export interface ScanResult {
  readonly ast: Program | null;
  readonly errors: readonly ScanError[];
}

/**
 * Map a recognised file extension to a parser `Language`. The dispatch table
 * mirrors `parsers/types.ts`: .cjs/.js/.mjs -> js, .jsx -> jsx, .ts -> ts,
 * .tsx -> tsx.
 */
function languageFor(extension: string): Language | null {
  switch (extension) {
    case '.ts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.jsx':
      return 'jsx';
    case '.js':
    case '.cjs':
    case '.mjs':
      return 'js';
    default:
      return null;
  }
}

/**
 * Extract the lowercased file extension (with leading dot). Returns `''` for
 * paths with no dot in the basename. Uses both `/` and `\` as separators so
 * Windows-style paths produce the same answer.
 */
function extensionOf(filename: string): string {
  // Find basename — last separator of either kind.
  let base = 0;
  for (let i = filename.length - 1; i >= 0; i--) {
    const ch = filename.charCodeAt(i);
    if (ch === 0x2f /* / */ || ch === 0x5c /* \ */) {
      base = i + 1;
      break;
    }
  }
  const basename = filename.slice(base);
  const dot = basename.lastIndexOf('.');
  if (dot <= 0) return '';
  return basename.slice(dot).toLowerCase();
}

/**
 * Scan a single source file. See file-level docstring for the full contract.
 *
 * `filename` is used for both extension dispatch and error attribution (it is
 * threaded through to `parse()` and into every emitted `ScanError`). `source`
 * is the file's contents — `scanFile` does not read from disk in this wave.
 */
export async function scanFile(filename: string, source: string): Promise<ScanResult> {
  const extension = extensionOf(filename);
  const lang = extension === '' ? null : languageFor(extension);
  if (lang === null) {
    const error: ScanError = {
      kind: 'unsupported_language',
      file: filename,
      extension,
      message: unsupportedLanguageMessage(filename, extension),
    };
    return { ast: null, errors: [error] };
  }

  const result = await parse(source, { filename, lang });
  if (result.errors.length === 0) {
    return { ast: result.program, errors: [] };
  }
  const mapped: readonly ParseFailedScanError[] = result.errors.map((e) => ({
    kind: 'parse_failed' as const,
    file: e.file,
    position: e.position,
    message: e.message,
    code: e.code,
  }));
  return { ast: result.program, errors: mapped };
}

/** Sort priority by `kind` — ensures stable ordering across mixed batches. */
function kindPriority(kind: ScanError['kind']): number {
  switch (kind) {
    case 'parse_failed':
      return 0;
    case 'unsupported_language':
      return 1;
    case 'io':
      return 2;
  }
}

function compareScanErrors(a: ScanError, b: ScanError): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  const ka = kindPriority(a.kind);
  const kb = kindPriority(b.kind);
  if (ka !== kb) return ka - kb;
  // Within same file & kind: only `parse_failed` carries a position; tie-break
  // by line then column. Other kinds are insertion-stable (return 0).
  if (a.kind === 'parse_failed' && b.kind === 'parse_failed') {
    if (a.position.line !== b.position.line) return a.position.line - b.position.line;
    return a.position.column - b.position.column;
  }
  return 0;
}

/**
 * Collects fail-soft `ScanError`s during a walk. `drain()` returns a
 * deterministically-sorted snapshot without clearing internal state, so an
 * orchestrator can drain repeatedly between phases.
 */
export class ScanErrorAggregator {
  readonly #errors: ScanError[] = [];

  add(error: ScanError): void {
    this.#errors.push(error);
  }

  addMany(errors: readonly ScanError[]): void {
    for (const e of errors) this.#errors.push(e);
  }

  /**
   * Returns a NEW SORTED COPY of the accumulated errors. Sort key:
   *   1. file (bare lexicographic, no localeCompare per SC-15)
   *   2. kind priority (parse_failed < unsupported_language < io)
   *   3. for parse_failed within same file: position.line, then position.column
   * Internal state is NOT mutated — repeated calls return equal arrays.
   */
  drain(): readonly ScanError[] {
    return [...this.#errors].sort(compareScanErrors);
  }

  count(): number {
    return this.#errors.length;
  }

  clear(): void {
    this.#errors.length = 0;
  }
}
