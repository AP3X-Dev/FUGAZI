/**
 * suppress-py.test.ts — Phase 4a T308 acceptance for the Python suppression
 * comment parser. Mirrors the TS variant's fixture pattern, substituting `#`
 * for `//` in the directive syntax. Verbatim warning strings unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetForTest, __sizeForTest } from '../suppress/dedup.js';
import { parseSuppressionsByLang } from '../suppress/index.js';
import { type Suppression, parseSuppressionsPy } from '../suppress/parse-py.js';

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

describe('parseSuppressionsPy — fixture cases (T308)', () => {
  it('1. # fugazi-ignore-next-line above target line', async () => {
    const src = '# fugazi-ignore-next-line unused-exports\ndef foo(): pass\n';
    const result = parseSuppressionsPy(src, 'a.py');
    expect(result.length).toBe(1);
    expect(pick(result[0] as Suppression)).toEqual({
      file: 'a.py',
      line: 1,
      kind: 'next-line',
      issueTypes: ['unused-exports'],
    });
    expect(warningMessages()).toEqual([]);
  });

  it('2. # fugazi-ignore-file at top of file', async () => {
    const src = '# fugazi-ignore-file code-duplication\ndef foo(): pass\n';
    const result = parseSuppressionsPy(src, 'b.py');
    expect(result.length).toBe(1);
    expect(pick(result[0] as Suppression)).toEqual({
      file: 'b.py',
      line: 1,
      kind: 'file',
      issueTypes: ['code-duplication'],
    });
  });

  it('4. unknown token emits did-you-mean suggestion', async () => {
    const src = '# fugazi-ignore-next-line unsued-exports\ndef foo(): pass\n';
    const result = parseSuppressionsPy(src, 'd.py');
    expect(result.length).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['unsued-exports']);
    expect(warningMessages()).toEqual([
      "unknown ignore token 'unsued-exports' in d.py; did you mean 'unused-exports'?",
    ]);
  });

  it('5. # inside a string literal still gets parsed (deliberate v1 false positive)', async () => {
    const src = 'x = "# fugazi-ignore-next-line unused-exports"\n';
    const result = parseSuppressionsPy(src, 'e.py');
    // The directive AFTER the `#` matches; the trailing closing quote is
    // captured as part of the token. This is the deliberate v1 false-
    // positive parity with the TS variant.
    expect(result.length).toBe(1);
    // `unused-exports"` is the trailing-quote-bearing token.
    expect((result[0] as Suppression).issueTypes).toEqual(['unused-exports"']);
    expect(warningMessages().some((m) => m.includes('unknown ignore token'))).toBe(true);
  });

  it('6. multiple suppressions on consecutive lines', async () => {
    const src = [
      '# fugazi-ignore-next-line unused-exports',
      'def a(): pass',
      '# fugazi-ignore-next-line unused-types',
      'class B: pass',
      '',
    ].join('\n');
    const result = parseSuppressionsPy(src, 'f.py');
    expect(result.length).toBe(2);
    expect((result[0] as Suppression).line).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['unused-exports']);
    expect((result[1] as Suppression).line).toBe(3);
    expect((result[1] as Suppression).issueTypes).toEqual(['unused-types']);
  });

  it('determinism: byte-equal JSON.stringify across repeated runs', async () => {
    const src = [
      '# fugazi-ignore-file unused-files',
      'def a(): pass',
      '# fugazi-ignore-next-line unused-exports unused-types',
      'def b(): pass',
      '',
    ].join('\n');
    const a = JSON.stringify(parseSuppressionsPy(src, 'h.py'));
    const b = JSON.stringify(parseSuppressionsPy(src, 'h.py'));
    const c = JSON.stringify(parseSuppressionsPy(src, 'h.py'));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('empty source → empty Suppression[] (no warnings)', async () => {
    const result = parseSuppressionsPy('', 'empty.py');
    expect(result).toEqual([]);
    expect(warningMessages()).toEqual([]);
  });

  it('does NOT match the TS-style `// fugazi-ignore-next-line`', async () => {
    const src = '// fugazi-ignore-next-line unused-exports\ndef foo(): pass\n';
    const result = parseSuppressionsPy(src, 'i.py');
    expect(result).toEqual([]);
  });
});

describe('parseSuppressionsByLang — dispatch by extension', () => {
  it('routes .py to the Python parser', async () => {
    const src = '# fugazi-ignore-next-line unused-exports\ndef foo(): pass\n';
    const result = parseSuppressionsByLang(src, 'a.py');
    expect(result.length).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['unused-exports']);
  });

  it('routes .pyi to the Python parser', async () => {
    const src = '# fugazi-ignore-file unused-types\nclass X: ...\n';
    const result = parseSuppressionsByLang(src, 'a.pyi');
    expect(result.length).toBe(1);
    expect((result[0] as Suppression).kind).toBe('file');
  });

  it('routes .ts to the TS parser', async () => {
    const src = '// fugazi-ignore-next-line unused-exports\nexport const a = 1;\n';
    const result = parseSuppressionsByLang(src, 'a.ts');
    expect(result.length).toBe(1);
    expect((result[0] as Suppression).issueTypes).toEqual(['unused-exports']);
  });

  it('a Python `#` directive in a `.ts` file is NOT matched (TS uses `//`)', async () => {
    const src = '# fugazi-ignore-next-line unused-exports\nexport const a = 1;\n';
    const result = parseSuppressionsByLang(src, 'a.ts');
    expect(result).toEqual([]);
  });
});

describe('parseSuppressionsPy — dedup state', () => {
  it('__resetForTest cleanly clears warn-once state', async () => {
    parseSuppressionsPy('# fugazi-ignore-next-line zzzzzz\ndef a(): pass\n', 'r.py');
    expect(__sizeForTest()).toBeGreaterThan(0);
    __resetForTest();
    expect(__sizeForTest()).toBe(0);
    parseSuppressionsPy('# fugazi-ignore-next-line zzzzzz\ndef a(): pass\n', 'r.py');
    const warns = warningMessages().filter((m) => m.includes('unknown ignore token'));
    expect(warns.length).toBe(2);
  });
});
