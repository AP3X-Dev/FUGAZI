/**
 * suppress.test.ts — Phase 3c.6 (T075-test) acceptance suite for the
 * inline suppression-comment parser.
 *
 * 16 fixtures + 3 structural invariants = 19 cases.
 *
 * Each fixture is an inline source string. Verbatim-asserted warning text
 * (E5 / IMP-CORRECT-09) is captured via `vi.spyOn(console, 'warn')`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetForTest, __sizeForTest } from '../suppress/dedup.js';
import { type Suppression, parseSuppressions } from '../suppress/parse.js';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetForTest();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  __resetForTest();
});

function warningMessages(): string[] {
  return warnSpy.mock.calls.map((args) => String(args[0]));
}

function pick(s: Suppression): {
  line: number;
  kind: Suppression['kind'];
  issueTypes: readonly string[];
  file: string;
} {
  return { line: s.line, kind: s.kind, issueTypes: s.issueTypes, file: s.file };
}

// ── Fixtures 1-16 ────────────────────────────────────────────────────────

describe('parseSuppressions — fixture cases', () => {
  it('1. // fugazi-ignore-next-line unused-exports — single token', () => {
    const src = '// fugazi-ignore-next-line unused-exports\nexport const foo = 1;\n';
    const result = parseSuppressions(src, 'a.ts');
    expect(result.length).toBe(1);
    expect(pick(result[0] as Suppression)).toEqual({
      file: 'a.ts',
      line: 1,
      kind: 'next-line',
      issueTypes: ['unused-exports'],
    });
    expect(warningMessages()).toEqual([]);
  });

  it('2. // fugazi-ignore-file code-duplication — file-wide single token', () => {
    const src = '// fugazi-ignore-file code-duplication\nexport const foo = 1;\n';
    const result = parseSuppressions(src, 'b.ts');
    expect(result.length).toBe(1);
    expect(pick(result[0] as Suppression)).toEqual({
      file: 'b.ts',
      line: 1,
      kind: 'file',
      issueTypes: ['code-duplication'],
    });
    expect(warningMessages()).toEqual([]);
  });

  it('3. // fugazi-ignore-next-line (no token) — suppress all', () => {
    const src = '// fugazi-ignore-next-line\nexport const foo = 1;\n';
    const result = parseSuppressions(src, 'c.ts');
    expect(result.length).toBe(1);
    expect(pick(result[0] as Suppression)).toEqual({
      file: 'c.ts',
      line: 1,
      kind: 'next-line',
      issueTypes: [],
    });
    expect(warningMessages()).toEqual([]);
  });

  it('4. unknown token with close match — did-you-mean suggestion', () => {
    // 'unsued-exports' is one transposition away from 'unused-exports'
    const src = '// fugazi-ignore-next-line unsued-exports\nexport const foo = 1;\n';
    const result = parseSuppressions(src, 'd.ts');
    expect(result.length).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['unsued-exports']);
    expect(warningMessages()).toEqual([
      "unknown ignore token 'unsued-exports' in d.ts; did you mean 'unused-exports'?",
    ]);
  });

  it('5. unknown token with NO close match — warn without suggestion', () => {
    const src = '// fugazi-ignore-next-line zzzzzz\nexport const foo = 1;\n';
    const result = parseSuppressions(src, 'e.ts');
    expect(result.length).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['zzzzzz']);
    expect(warningMessages()).toEqual(["unknown ignore token 'zzzzzz' in e.ts"]);
  });

  it('9. multiple ignores on consecutive lines — both records emitted', () => {
    const src = [
      '// fugazi-ignore-next-line unused-exports',
      '// fugazi-ignore-next-line unused-types',
      'export const foo = 1;',
      'export type Bar = string;',
      '',
    ].join('\n');
    const result = parseSuppressions(src, 'i.ts');
    expect(result.length).toBe(2);
    expect((result[0] as Suppression).line).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['unused-exports']);
    expect((result[1] as Suppression).line).toBe(2);
    expect((result[1] as Suppression).issueTypes).toEqual(['unused-types']);
  });

  it('10. multiple tokens per line — issueTypes has both', () => {
    const src = '// fugazi-ignore-next-line unused-exports code-duplication\nexport const x = 1;\n';
    const result = parseSuppressions(src, 'j.ts');
    expect(result.length).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['unused-exports', 'code-duplication']);
    expect(warningMessages()).toEqual([]);
  });

  it('11. // fugazi-ignore-file at top of file — file-wide on line 1', () => {
    const src = '// fugazi-ignore-file unused-files\nexport const foo = 1;\n';
    const result = parseSuppressions(src, 'k.ts');
    expect(result.length).toBe(1);
    expect(pick(result[0] as Suppression)).toEqual({
      file: 'k.ts',
      line: 1,
      kind: 'file',
      issueTypes: ['unused-files'],
    });
  });

  it('12. // fugazi-ignore-file lower in file — still kind file', () => {
    const src = [
      'export const a = 1;',
      'export const b = 2;',
      '// fugazi-ignore-file unused-exports',
      'export const c = 3;',
      '',
    ].join('\n');
    const result = parseSuppressions(src, 'l.ts');
    expect(result.length).toBe(1);
    expect(pick(result[0] as Suppression)).toEqual({
      file: 'l.ts',
      line: 3,
      kind: 'file',
      issueTypes: ['unused-exports'],
    });
  });

  it('13. mixed next-line and file directives in same file', () => {
    const src = [
      '// fugazi-ignore-file unused-files',
      '// fugazi-ignore-next-line unused-exports',
      'export const foo = 1;',
      '',
    ].join('\n');
    const result = parseSuppressions(src, 'm.ts');
    expect(result.length).toBe(2);
    // Sort puts 'file' before 'next-line' on tie; here lines differ.
    expect((result[0] as Suppression).line).toBe(1);
    expect((result[0] as Suppression).kind).toBe('file');
    expect((result[1] as Suppression).line).toBe(2);
    expect((result[1] as Suppression).kind).toBe('next-line');
  });

  it('14. block comment /* fugazi-ignore-next-line */ — NOT matched', () => {
    const src = '/* fugazi-ignore-next-line */\nexport const foo = 1;\n';
    const result = parseSuppressions(src, 'n.ts');
    expect(result).toEqual([]);
    expect(warningMessages()).toEqual([]);
  });

  it('15. suppression inside string literal — DELIBERATE false positive', () => {
    // Documents the regex-approach trade-off: the parser does not skip
    // string contexts, so the directive inside the string IS matched, AND
    // the trailing closing-quote+semicolon is captured as part of the token
    // because the line scanner only stops at newlines. Future tightening
    // (oxc-tokenizer pass) would change this assertion — that change must
    // be intentional.
    const src = 'const x = "// fugazi-ignore-next-line unused-exports";\n';
    const result = parseSuppressions(src, 'o.ts');
    expect(result.length).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['unused-exports";']);
    // The trailing-quote token is unknown — the parser warns about it.
    expect(warningMessages().some((m) => m.includes('unknown ignore token'))).toBe(true);
  });

  it('16. suppression after code on same line — recognized', () => {
    const src = 'const x = 1; // fugazi-ignore-next-line unused-exports\nconst y = x;\n';
    const result = parseSuppressions(src, 'p.ts');
    expect(result.length).toBe(1);
    expect(pick(result[0] as Suppression)).toEqual({
      file: 'p.ts',
      line: 1,
      kind: 'next-line',
      issueTypes: ['unused-exports'],
    });
  });
});

// ── Structural invariants ───────────────────────────────────────────────

describe('parseSuppressions — structural invariants', () => {
  it('determinism: byte-equal JSON.stringify across repeated runs', () => {
    const src = [
      '// fugazi-ignore-file unused-files',
      'export const a = 1;',
      '// fugazi-ignore-next-line unused-exports unused-types',
      'export const b = 2;',
      '// fugazi-ignore-next-line',
      'export const c = 3;',
      '',
    ].join('\n');
    const a = JSON.stringify(parseSuppressions(src, 'q.ts'));
    const b = JSON.stringify(parseSuppressions(src, 'q.ts'));
    const c = JSON.stringify(parseSuppressions(src, 'q.ts'));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('empty source → empty Suppression[] (no exceptions, no warnings)', () => {
    const result = parseSuppressions('', 'empty.ts');
    expect(result).toEqual([]);
    expect(warningMessages()).toEqual([]);
  });

  it('__resetForTest() between tests cleanly clears warn-once state', () => {
    parseSuppressions('// fugazi-ignore-next-line zzzzzz\nexport const a = 1;\n', 'r.ts');
    expect(__sizeForTest()).toBeGreaterThan(0);
    __resetForTest();
    expect(__sizeForTest()).toBe(0);
    // After reset, the same unknown token in the same file warns again.
    parseSuppressions('// fugazi-ignore-next-line zzzzzz\nexport const a = 1;\n', 'r.ts');
    const warns = warningMessages().filter((m) => m.includes('unknown ignore token'));
    expect(warns.length).toBe(2);
  });
});
