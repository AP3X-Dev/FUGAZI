/**
 * select.test.ts — Phase 3h.1 (T179-T180) — `selectReporter` factory dispatch.
 */

import { describe, expect, it } from 'vitest';
import { CodeclimateReporter } from '../codeclimate.js';
import { CompactReporter } from '../compact.js';
import { HumanPlainReporter } from '../human-plain.js';
import { HumanReporter } from '../human.js';
import { JsonReporter } from '../json.js';
import { MarkdownReporter } from '../markdown.js';
import { SarifReporter } from '../sarif.js';
import { selectReporter } from '../select.js';
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
