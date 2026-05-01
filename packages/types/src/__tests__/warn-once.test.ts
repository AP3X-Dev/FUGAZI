import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WarnOnce, globalWarnOnce } from '../warn-once.js';

describe('WarnOnce instance', () => {
  it('returns true the first time it sees a (message, file) pair', () => {
    const w = new WarnOnce();
    expect(w.warn('m', 'a.ts')).toBe(true);
  });

  it('returns false on a repeat of the same (message, file) pair', () => {
    const w = new WarnOnce();
    expect(w.warn('m', 'a.ts')).toBe(true);
    expect(w.warn('m', 'a.ts')).toBe(false);
  });

  it('treats the same message in different files as independent buckets', () => {
    const w = new WarnOnce();
    expect(w.warn('shared message', 'a.ts')).toBe(true);
    expect(w.warn('shared message', 'b.ts')).toBe(true);
    expect(w.warn('shared message', 'a.ts')).toBe(false);
    expect(w.warn('shared message', 'b.ts')).toBe(false);
  });

  it('treats different messages in the same file as independent buckets', () => {
    const w = new WarnOnce();
    expect(w.warn('m1', 'a.ts')).toBe(true);
    expect(w.warn('m2', 'a.ts')).toBe(true);
    expect(w.warn('m1', 'a.ts')).toBe(false);
  });

  it('defaults file to empty string when omitted', () => {
    const w = new WarnOnce();
    expect(w.warn('m')).toBe(true);
    expect(w.warn('m')).toBe(false);
    // Calling explicit '' must collide with the omitted form.
    expect(w.warn('m', '')).toBe(false);
  });

  it('disambiguates ("foo", "bar") from ("foobar", "") via the separator', () => {
    const w = new WarnOnce();
    expect(w.warn('foo', 'bar')).toBe(true);
    // If the separator were absent, both pairs would key to "barfoo" / "foobar"
    // and one would falsely dedupe. Each must independently return true.
    expect(w.warn('foobar', '')).toBe(true);
  });

  it('reset() clears the dedup set', () => {
    const w = new WarnOnce();
    w.warn('m', 'a.ts');
    w.warn('m', 'b.ts');
    expect(w.size).toBe(2);
    w.reset();
    expect(w.size).toBe(0);
    expect(w.warn('m', 'a.ts')).toBe(true);
  });

  it('size getter increments per unique (message, file) pair only', () => {
    const w = new WarnOnce();
    expect(w.size).toBe(0);
    w.warn('m', 'a.ts');
    expect(w.size).toBe(1);
    w.warn('m', 'a.ts');
    expect(w.size).toBe(1);
    w.warn('m', 'b.ts');
    expect(w.size).toBe(2);
  });

  it('two instances do not share state', () => {
    const w1 = new WarnOnce();
    const w2 = new WarnOnce();
    expect(w1.warn('m', 'a.ts')).toBe(true);
    expect(w2.warn('m', 'a.ts')).toBe(true);
  });
});

describe('globalWarnOnce module singleton', () => {
  it('is an instance of WarnOnce', () => {
    expect(globalWarnOnce).toBeInstanceOf(WarnOnce);
  });

  it('is the same instance across re-imports of the module', async () => {
    const mod = await import('../warn-once.js');
    expect(mod.globalWarnOnce).toBe(globalWarnOnce);
  });

  it('persists state across calls via the singleton', () => {
    globalWarnOnce.reset();
    expect(globalWarnOnce.warn('singleton-msg', 'x.ts')).toBe(true);
    expect(globalWarnOnce.warn('singleton-msg', 'x.ts')).toBe(false);
    globalWarnOnce.reset();
  });
});

describe('WarnOnce implementation contract', () => {
  it('does not import any mutex / lock library', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'warn-once.ts'), 'utf8');
    const forbidden = ['async-mutex', 'await-mutex', 'mutex-promise', 'mutex-lock'];
    for (const lib of forbidden) {
      expect(src).not.toContain(lib);
    }
  });
});
