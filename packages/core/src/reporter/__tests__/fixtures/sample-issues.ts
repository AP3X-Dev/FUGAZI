/**
 * sample-issues.ts — Phase 3j — canonical reporter fixture.
 *
 * Three issues across two files plus one progress event. Crafted so every
 * format reporter sees:
 *   - one dead-code finding with a range,
 *   - one duplicate finding with a range,
 *   - one health finding with a range,
 *   - mixed severities (error / warn / off → exercises every wire mapping),
 *   - shuffled input order so determinism tests catch sort regressions.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import type { ProgressEvent } from '../../../types.js';

const ROOT = '/tmp/proj';
export const SAMPLE_ROOT = ROOT;

export const SAMPLE_META = {
  mode: 'full' as const,
  version: '1.2.3',
  projectRoot: ROOT,
};

/**
 * Three issues, intentionally NOT pre-sorted by `(file, line)`.
 *
 *   - `b.ts:20` complexity hotspot (warn, health).
 *   - `a.ts:10` unused export (error, dead-code).
 *   - `b.ts:30` duplicate export (off, duplicates).
 */
export const SAMPLE_ISSUES: readonly DiscriminatedIssue[] = [
  {
    kind: 'complexity-hotspot',
    severity: 'warn',
    file: `${ROOT}/src/b.ts`,
    range: {
      start: { line: 20, column: 4, byteOffset: 100 },
      end: { line: 25, column: 4, byteOffset: 200 },
    },
    message: 'Function exceeds cyclomatic threshold',
    score: 18,
    metric: 'cyclomatic',
  },
  {
    kind: 'unused-exports',
    severity: 'error',
    file: `${ROOT}/src/a.ts`,
    range: {
      start: { line: 10, column: 0, byteOffset: 50 },
      end: { line: 10, column: 16, byteOffset: 66 },
    },
    message: "Export 'foo' is never imported",
    exportName: 'foo',
  },
  {
    kind: 'duplicate-exports',
    severity: 'off',
    file: `${ROOT}/src/b.ts`,
    range: {
      start: { line: 30, column: 0, byteOffset: 300 },
      end: { line: 30, column: 12, byteOffset: 312 },
    },
    message: "Duplicate export 'Config'",
    exportName: 'Config',
    occurrences: [
      {
        file: `${ROOT}/src/a.ts`,
        range: {
          start: { line: 5, column: 0, byteOffset: 30 },
          end: { line: 5, column: 12, byteOffset: 42 },
        },
      },
      {
        file: `${ROOT}/src/b.ts`,
        range: {
          start: { line: 30, column: 0, byteOffset: 300 },
          end: { line: 30, column: 12, byteOffset: 312 },
        },
      },
    ],
  },
];

export const SAMPLE_EVENTS: readonly ProgressEvent[] = [
  { seq: 0, kind: 'discover.start' },
];

/**
 * Sorted view of `SAMPLE_ISSUES` — what the reporter must produce after its
 * defensive re-sort. Lex-ascending by `(file, line, col, kind, message)`.
 */
export const SAMPLE_ISSUES_SORTED: readonly DiscriminatedIssue[] = [
  SAMPLE_ISSUES[1] as DiscriminatedIssue, // a.ts:10 unused-exports
  SAMPLE_ISSUES[0] as DiscriminatedIssue, // b.ts:20 complexity-hotspot
  SAMPLE_ISSUES[2] as DiscriminatedIssue, // b.ts:30 duplicate-exports
];
