/**
 * select.test.ts — Phase 3h.1 (T179-T180) — `selectReporter` factory dispatch.
 */

import { describe, expect, it } from 'vitest';
import { selectReporter } from '../select.js';
import {
  CodeclimateReporter,
  CompactReporter,
  HumanPlainReporter,
  HumanReporter,
  JsonReporter,
  MarkdownReporter,
  SarifReporter,
} from '../stubs.js';
import type { ReporterFormat } from '../types.js';

const CASES: ReadonlyArray<readonly [ReporterFormat, new () => unknown]> = [
  ['human', HumanReporter],
  ['human-plain', HumanPlainReporter],
  ['json', JsonReporter],
  ['sarif', SarifReporter],
  ['compact', CompactReporter],
  ['markdown', MarkdownReporter],
  ['codeclimate', CodeclimateReporter],
];

describe('selectReporter', () => {
  it.each(CASES)('1. dispatches %s → expected stub class', (format, Ctor) => {
    const r = selectReporter(format);
    expect(r).toBeInstanceOf(Ctor);
  });

  it('2. throws on an unknown format string', () => {
    expect(() => selectReporter('xml' as ReporterFormat)).toThrowError(
      'Unknown reporter format: xml',
    );
  });
});
