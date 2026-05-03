/**
 * human.test.ts — Phase 3j — HumanReporter (TTY-aware) byte-equal tests.
 *
 * In Vitest, `process.stdout.isTTY` is normally `undefined` so the reporter
 * defaults to plain output. The TTY-on branch is exercised by toggling the
 * flag for the duration of one test.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { HumanPlainReporter } from '../human-plain.js';
import { HumanReporter } from '../human.js';
import { SAMPLE_EVENTS, SAMPLE_ISSUES, SAMPLE_META } from './fixtures/sample-issues.js';
import { runReporter, shuffle } from './helpers.js';

const ORIGINAL_TTY = process.stdout.isTTY;
const ORIGINAL_NO_COLOR = process.env.NO_COLOR;

function setTty(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    writable: true,
    value,
  });
}

function setNoColor(value: string | undefined): void {
  if (value === undefined) {
    // Restore by reflective assignment so biome no-delete fires neither here
    // nor against `process.env`. Setting to `undefined` would leave the key
    // present with the literal string "undefined", so we use Reflect.deleteProperty.
    Reflect.deleteProperty(process.env, 'NO_COLOR');
  } else {
    process.env.NO_COLOR = value;
  }
}

describe('HumanReporter', () => {
  afterEach(() => {
    setTty(ORIGINAL_TTY);
    setNoColor(ORIGINAL_NO_COLOR);
  });

  it('1. empty issue list emits header + footer (no-TTY plain branch)', () => {
    setTty(false);
    setNoColor(undefined);
    const r = new HumanReporter();
    const out = runReporter(r, SAMPLE_META, [], []);
    expect(out).toContain('Fugazi v1.2.3');
    expect(out).toContain('0 issues found across 0 files in 0ms');
  });

  it('2. without TTY, output is byte-equal to HumanPlainReporter', () => {
    setTty(false);
    setNoColor(undefined);
    const a = runReporter(new HumanReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    const b = runReporter(new HumanPlainReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(a).toBe(b);
  });

  it('3. NO_COLOR env suppresses colour even when TTY is on', () => {
    setTty(true);
    setNoColor('1');
    const a = runReporter(new HumanReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    const b = runReporter(new HumanPlainReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(a).toBe(b);
  });

  it('4. with TTY enabled (no NO_COLOR), output contains ANSI escapes', () => {
    setTty(true);
    setNoColor(undefined);
    const r = new HumanReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(out.indexOf('\x1b')).toBeGreaterThanOrEqual(0);
  });

  it('5. determinism (no-TTY) — 50 iterations all produce byte-equal output', () => {
    setTty(false);
    setNoColor(undefined);
    const baseline = runReporter(new HumanReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let i = 0; i < 50; i++) {
      const out = runReporter(new HumanReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('6. determinism (TTY) — 50 iterations all produce byte-equal output', () => {
    setTty(true);
    setNoColor(undefined);
    const baseline = runReporter(new HumanReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let i = 0; i < 50; i++) {
      const out = runReporter(new HumanReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('7. shuffled-input issue list still sorts to the same output (no-TTY)', () => {
    setTty(false);
    setNoColor(undefined);
    const baseline = runReporter(new HumanReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = shuffle(SAMPLE_ISSUES, seed);
      const out = runReporter(new HumanReporter(), SAMPLE_META, shuffled, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('8. NO_COLOR=empty-string is NOT honoured (per the NO_COLOR convention)', () => {
    setTty(true);
    setNoColor('');
    const a = runReporter(new HumanReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    // Should still contain ANSI since empty NO_COLOR is treated as unset.
    expect(a.indexOf('\x1b')).toBeGreaterThanOrEqual(0);
  });
});
