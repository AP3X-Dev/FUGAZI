/**
 * contract.test.ts — Phase 3h.1 (T179-T180) — Reporter interface contract.
 *
 * Verifies the begin → emit* → end state machine on:
 *   1. An inline MockReporter that records its call sequence.
 *   2. Each of the seven shipped stubs (instanceof + happy path + return type).
 *
 * The contract-violation error strings (`reporter: emit called before begin`,
 * `reporter: begin called twice`, `reporter: emit called after end`) are
 * asserted byte-for-byte to lock the verbatim contract.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import type { ProgressEvent } from '../../types.js';
import {
  CodeclimateReporter,
  CompactReporter,
  HumanPlainReporter,
  HumanReporter,
  JsonReporter,
  MarkdownReporter,
  SarifReporter,
} from '../stubs.js';
import type { Reporter, ReporterMeta } from '../types.js';

const META: ReporterMeta = {
  mode: 'full',
  version: '0.0.0-test',
  projectRoot: '/tmp/proj',
};

const ISSUE: DiscriminatedIssue = {
  kind: 'unused-files',
  severity: 'warn',
  file: '/tmp/proj/a.ts',
  message: 'unused file',
  path: '/tmp/proj/a.ts',
};

const PROGRESS: ProgressEvent = { seq: 0, kind: 'discover.start' };

type CallLog =
  | { kind: 'begin'; meta: ReporterMeta }
  | { kind: 'emit'; issue: DiscriminatedIssue }
  | { kind: 'emitProgress'; event: ProgressEvent }
  | { kind: 'end' };

class MockReporter implements Reporter {
  readonly log: CallLog[] = [];

  begin(meta: ReporterMeta): void {
    this.log.push({ kind: 'begin', meta });
  }
  emit(issue: DiscriminatedIssue): void {
    this.log.push({ kind: 'emit', issue });
  }
  emitProgress(event: ProgressEvent): void {
    this.log.push({ kind: 'emitProgress', event });
  }
  end(): string {
    this.log.push({ kind: 'end' });
    return '';
  }
}

const STUB_CONSTRUCTORS = [
  ['human', HumanReporter],
  ['human-plain', HumanPlainReporter],
  ['json', JsonReporter],
  ['sarif', SarifReporter],
  ['compact', CompactReporter],
  ['markdown', MarkdownReporter],
  ['codeclimate', CodeclimateReporter],
] as const;

describe('Reporter contract', () => {
  it('1. MockReporter records begin → emit → emitProgress → emit → end sequence', () => {
    const r = new MockReporter();
    r.begin(META);
    r.emit(ISSUE);
    r.emitProgress(PROGRESS);
    r.emit(ISSUE);
    r.end();
    expect(r.log.map((c) => c.kind)).toEqual(['begin', 'emit', 'emitProgress', 'emit', 'end']);
  });

  it('2. emit before begin throws verbatim contract message', () => {
    const r = new JsonReporter();
    expect(() => r.emit(ISSUE)).toThrowError('reporter: emit called before begin');
  });

  it('3. emitProgress before begin throws', () => {
    const r = new JsonReporter();
    expect(() => r.emitProgress(PROGRESS)).toThrowError(
      'reporter: emitProgress called before begin',
    );
  });

  it('4. begin called twice throws verbatim contract message', () => {
    const r = new JsonReporter();
    r.begin(META);
    expect(() => r.begin(META)).toThrowError('reporter: begin called twice');
  });

  it('5. emit after end throws verbatim contract message', () => {
    const r = new JsonReporter();
    r.begin(META);
    r.end();
    expect(() => r.emit(ISSUE)).toThrowError('reporter: emit called after end');
  });

  it('6. emitProgress after end throws', () => {
    const r = new JsonReporter();
    r.begin(META);
    r.end();
    expect(() => r.emitProgress(PROGRESS)).toThrowError('reporter: emitProgress called after end');
  });

  it('7. end called out of sequence (before begin) throws', () => {
    const r = new JsonReporter();
    expect(() => r.end()).toThrowError('reporter: end called out of sequence');
  });

  it.each(STUB_CONSTRUCTORS)(
    '8. stub %s satisfies Reporter contract on the happy path',
    (_format, Ctor) => {
      const r = new Ctor();
      expect(r).toBeInstanceOf(Ctor);
      expect(() => r.begin(META)).not.toThrow();
      expect(() => r.emit(ISSUE)).not.toThrow();
      expect(() => r.emitProgress(PROGRESS)).not.toThrow();
      expect(() => r.emit(ISSUE)).not.toThrow();
      const out = r.end();
      // No v1 format returns Buffer; the union is hedged.
      expect(typeof out).toBe('string');
    },
  );

  it('9. stub end() output is deterministic (byte-equal) across instances', () => {
    const a = new JsonReporter();
    const b = new JsonReporter();
    for (const r of [a, b]) {
      r.begin(META);
      r.emit(ISSUE);
      r.emitProgress(PROGRESS);
    }
    expect(a.end()).toEqual(b.end());
  });
});
