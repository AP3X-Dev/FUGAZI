/**
 * scan-error.ts — Wave 5b-4 fail-soft error union for `scanFile`.
 *
 * Three kinds:
 *   - 'parse_failed'         — wraps a `ParseError` from the underlying adapter.
 *   - 'unsupported_language' — file extension not in `recognizedExtensions`.
 *   - 'io'                   — filesystem-level failure. Currently only
 *                              FS_PATH_NOT_FOUND is enumerated; FS_READ_FAILED
 *                              waits for Phase 3d when `scanPath()` lands.
 *
 * The error messages produced by `unsupportedLanguageMessage` /
 * `pathNotFoundMessage` are CONTRACT (IMP-CORRECT-09 / E5): downstream tests
 * pattern-match on them byte-for-byte.
 */

import type { Position } from '@fugazi/types';

export interface ParseFailedScanError {
  readonly kind: 'parse_failed';
  readonly file: string;
  readonly position: Position;
  readonly message: string;
  readonly code: 'PARSE_SYNTAX_ERROR';
}

export interface UnsupportedLanguageScanError {
  readonly kind: 'unsupported_language';
  readonly file: string;
  readonly extension: string;
  readonly message: string;
}

export interface IoScanError {
  readonly kind: 'io';
  readonly file: string;
  readonly code: 'FS_PATH_NOT_FOUND';
  readonly message: string;
}

export type ScanError = ParseFailedScanError | UnsupportedLanguageScanError | IoScanError;

/**
 * Verbatim message for an unsupported language. Format is contract — fixture-
 * asserted byte-for-byte.
 */
export function unsupportedLanguageMessage(file: string, extension: string): string {
  return `Unsupported language for file '${file}': extension '${extension}' is not recognized`;
}

/**
 * Verbatim message for a path-not-found IO failure. Format is contract —
 * fixture-asserted byte-for-byte.
 */
export function pathNotFoundMessage(file: string): string {
  return `File not found: '${file}'`;
}

/**
 * Lowercased file extensions (with leading dot) the scanner recognises.
 * Sorted alphabetically.
 *
 * Dispatch table (matches `parsers/types.ts` Language docstring):
 *   .cjs, .js, .mjs -> 'js'
 *   .jsx            -> 'jsx'
 *   .ts             -> 'ts'
 *   .tsx            -> 'tsx'
 */
export const recognizedExtensions: readonly string[] = [
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
];
