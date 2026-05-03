/**
 * matcher.test.ts — glob → RegExp compiler contract tests.
 */

import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesGlob } from '../matcher.js';

describe('globToRegExp — literal patterns', () => {
  it('matches an exact path', () => {
    expect(matchesGlob('next.config.ts', 'next.config.ts')).toBe(true);
  });
  it('does not match a different name', () => {
    expect(matchesGlob('next.config.ts', 'vite.config.ts')).toBe(false);
  });
  it('escapes regex metacharacters', () => {
    expect(matchesGlob('a+b.ts', 'a+b.ts')).toBe(true);
    expect(matchesGlob('a+b.ts', 'aab.ts')).toBe(false);
  });
});

describe('globToRegExp — single-star', () => {
  it('matches within a single segment', () => {
    expect(matchesGlob('src/*.ts', 'src/foo.ts')).toBe(true);
  });
  it('does not cross segments', () => {
    expect(matchesGlob('src/*.ts', 'src/a/b.ts')).toBe(false);
  });
  it('matches an empty middle', () => {
    expect(matchesGlob('a*b', 'ab')).toBe(true);
  });
});

describe('globToRegExp — double-star', () => {
  it('matches any number of segments', () => {
    expect(matchesGlob('app/**/page.ts', 'app/foo/bar/page.ts')).toBe(true);
  });
  it('matches zero segments', () => {
    expect(matchesGlob('app/**/page.ts', 'app/page.ts')).toBe(true);
  });
  it('matches at the start', () => {
    expect(matchesGlob('**/test.ts', 'a/b/c/test.ts')).toBe(true);
  });
  it('matches at the end', () => {
    expect(matchesGlob('src/**', 'src/a/b/c.ts')).toBe(true);
  });
});

describe('globToRegExp — single-char', () => {
  it('matches one non-separator char', () => {
    expect(matchesGlob('?.ts', 'a.ts')).toBe(true);
  });
  it('does not match more than one char', () => {
    expect(matchesGlob('?.ts', 'ab.ts')).toBe(false);
  });
  it('does not match a separator', () => {
    expect(matchesGlob('?.ts', '/.ts')).toBe(false);
  });
});

describe('globToRegExp — brace expansion', () => {
  it('matches simple brace alternatives', () => {
    expect(matchesGlob('foo.{ts,js}', 'foo.ts')).toBe(true);
    expect(matchesGlob('foo.{ts,js}', 'foo.js')).toBe(true);
    expect(matchesGlob('foo.{ts,js}', 'foo.tsx')).toBe(false);
  });
  it('matches multi-char alternatives', () => {
    expect(matchesGlob('foo.{ts,tsx,js,jsx}', 'foo.tsx')).toBe(true);
  });
  it('handles brace alternatives mid-pattern', () => {
    expect(matchesGlob('app/{a,b}/page.ts', 'app/a/page.ts')).toBe(true);
    expect(matchesGlob('app/{a,b}/page.ts', 'app/c/page.ts')).toBe(false);
  });
  it('combines brace expansion with **', () => {
    expect(matchesGlob('app/**/page.{ts,tsx}', 'app/a/b/page.tsx')).toBe(true);
  });
  it('handles unmatched brace gracefully', () => {
    // Unmatched `{` falls through to literal handling.
    expect(matchesGlob('foo{bar.ts', 'foo{bar.ts')).toBe(true);
  });
});

describe('globToRegExp — anchored', () => {
  it('does not match a longer string', () => {
    expect(matchesGlob('foo', 'foo-extra')).toBe(false);
  });
  it('does not match a shorter prefix', () => {
    expect(matchesGlob('foo-bar', 'foo')).toBe(false);
  });
});

describe('globToRegExp — determinism', () => {
  it('same pattern yields same source', () => {
    const a = globToRegExp('app/**/page.{ts,tsx}');
    const b = globToRegExp('app/**/page.{ts,tsx}');
    expect(a.source).toBe(b.source);
  });
});
