/**
 * scan-error.test.ts — T053-test acceptance suite for the fail-soft
 * `ScanError` union, `scanFile()` wrapper, and `ScanErrorAggregator` (Wave 5b-4).
 *
 * Acceptance map (from docs/superpowers/plans/02-phase-3c-3d-3e.md L383..411):
 *   1. Discriminated-union exhaustive match via `assertNever`.
 *   2. Unsupported language returns verbatim message; parser is NOT invoked.
 *   3. No-extension file emits unsupported_language with extension ''.
 *   4. Syntax errors surface as `parse_failed` ScanErrors (1:1 with ParseError).
 *   5. Successful parse returns Program + empty errors.
 *   6. WASM integrity errors PROPAGATE through scanFile (not wrapped).
 *   7. Aggregator deterministic sort (file, kind-priority, line, column).
 *   8. Aggregator count + clear semantics.
 *   9. Aggregator drain idempotence (drain does not mutate).
 */

import { FugaziParseError, assertNever } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanErrorAggregator, scanFile } from '../parsers/scan.js';
import {
  type IoScanError,
  type ParseFailedScanError,
  type ScanError,
  type UnsupportedLanguageScanError,
  pathNotFoundMessage,
  recognizedExtensions,
  unsupportedLanguageMessage,
} from '../scan-error.js';
import { type Manifest, __setManifestForTest } from '../wasm/integrity.js';
import { __clearWasmCacheForTest } from '../wasm/load.js';

// Mirror of parser-oxc.test.ts — keep the on-disk pin in sync so default-good
// tests do not need a manifest override.
const REAL_MANIFEST: Manifest = {
  blobs: {
    swc: {
      path: 'node_modules/@swc/wasm/wasm_bg.wasm',
      sha256: 'a400243367e0731a958f97e4cafd76b7282bd361c6a13e65d1d177d32ee125ec',
    },
  },
};

beforeEach(() => {
  __setManifestForTest(REAL_MANIFEST);
  __clearWasmCacheForTest();
});

afterEach(() => {
  __setManifestForTest(null);
  __clearWasmCacheForTest();
});

describe('ScanError discriminated union', () => {
  // T053-test #1: TS exhaustiveness via assertNever. If a kind is added to
  // the union without a matching case, the `assertNever(err)` line fails the
  // type-check.
  function describeKind(err: ScanError): string {
    switch (err.kind) {
      case 'parse_failed':
        return 'parse_failed';
      case 'unsupported_language':
        return 'unsupported_language';
      case 'io':
        return 'io';
      default:
        return assertNever(err);
    }
  }

  it('exhaustive switch via assertNever returns the kind label for every variant', () => {
    const parseFailed: ParseFailedScanError = {
      kind: 'parse_failed',
      file: 'a.ts',
      position: { line: 1, column: 0, byteOffset: 0 },
      message: 'oops',
      code: 'PARSE_SYNTAX_ERROR',
    };
    const unsupported: UnsupportedLanguageScanError = {
      kind: 'unsupported_language',
      file: 'a.unknown',
      extension: '.unknown',
      message: unsupportedLanguageMessage('a.unknown', '.unknown'),
    };
    const io: IoScanError = {
      kind: 'io',
      file: 'a.ts',
      code: 'FS_PATH_NOT_FOUND',
      message: pathNotFoundMessage('a.ts'),
    };
    expect(describeKind(parseFailed)).toBe('parse_failed');
    expect(describeKind(unsupported)).toBe('unsupported_language');
    expect(describeKind(io)).toBe('io');
  });

  it('unsupportedLanguageMessage produces the verbatim contract format', () => {
    expect(unsupportedLanguageMessage('foo.unknown', '.unknown')).toBe(
      `Unsupported language for file 'foo.unknown': extension '.unknown' is not recognized`,
    );
    expect(unsupportedLanguageMessage('Makefile', '')).toBe(
      `Unsupported language for file 'Makefile': extension '' is not recognized`,
    );
  });

  it('pathNotFoundMessage produces the verbatim contract format', () => {
    expect(pathNotFoundMessage('a/b/c.ts')).toBe(`File not found: 'a/b/c.ts'`);
  });

  it('recognizedExtensions is sorted alphabetically and covers .ts/.tsx/.js/.jsx/.cjs/.mjs', () => {
    expect([...recognizedExtensions]).toEqual(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
    const sorted = [...recognizedExtensions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect([...recognizedExtensions]).toEqual(sorted);
  });
});

describe('scanFile — extension dispatch', () => {
  // T053-test #2: unsupported extension short-circuits before `parse()` is
  // touched. We assert this by INVALIDATING the WASM manifest first — if
  // scanFile reached `parse()`, it would throw FugaziParseError(WASM_MISSING)
  // and this test would fail.
  it('returns unsupported_language for unknown extension WITHOUT invoking parser', async () => {
    __setManifestForTest({ blobs: {} });
    __clearWasmCacheForTest();

    const r = await scanFile('foo.unknown', 'whatever');
    expect(r.ast).toBeNull();
    expect(r.errors.length).toBe(1);
    const err = r.errors[0];
    if (err === undefined) throw new Error('expected one error');
    expect(err.kind).toBe('unsupported_language');
    if (err.kind !== 'unsupported_language') return;
    expect(err.file).toBe('foo.unknown');
    expect(err.extension).toBe('.unknown');
    expect(err.message).toBe(unsupportedLanguageMessage('foo.unknown', '.unknown'));
  });

  // T053-test #3: empty extension (no dot in basename).
  it('returns unsupported_language with empty extension for files with no dot', async () => {
    __setManifestForTest({ blobs: {} });
    __clearWasmCacheForTest();

    const r = await scanFile('Makefile', 'whatever');
    expect(r.ast).toBeNull();
    expect(r.errors.length).toBe(1);
    const err = r.errors[0];
    if (err === undefined) throw new Error('expected one error');
    if (err.kind !== 'unsupported_language') {
      throw new Error(`expected unsupported_language, got ${err.kind}`);
    }
    expect(err.extension).toBe('');
    expect(err.message).toBe(unsupportedLanguageMessage('Makefile', ''));
  });

  it('lowercases the extension before dispatch — .TS is recognised as ts', async () => {
    const r = await scanFile('A.TS', 'export const x = 1;');
    expect(r.errors).toEqual([]);
    expect(r.ast).not.toBeNull();
  });
});

describe('scanFile — parse mapping', () => {
  // T053-test #4: syntax errors map 1:1 to parse_failed ScanErrors.
  it('maps syntax errors to parse_failed ScanErrors with verbatim fields', async () => {
    const r = await scanFile('broken.ts', 'const x = ;');
    expect(r.ast).toBeNull();
    expect(r.errors.length).toBeGreaterThanOrEqual(1);
    const first = r.errors[0];
    if (first === undefined) throw new Error('expected at least one error');
    expect(first.kind).toBe('parse_failed');
    if (first.kind !== 'parse_failed') return;
    expect(first.code).toBe('PARSE_SYNTAX_ERROR');
    expect(first.file).toBe('broken.ts');
    expect(first.position.line).toBeGreaterThanOrEqual(1);
    expect(first.message.length).toBeGreaterThan(0);
  });

  // T053-test #5: success path — Program + empty errors.
  it('returns the parsed Program with empty errors for valid TS', async () => {
    const r = await scanFile('a.ts', 'export const x = 1;');
    expect(r.errors).toEqual([]);
    expect(r.ast).not.toBeNull();
    if (r.ast === null) return;
    expect(r.ast.kind).toBe('Program');
    expect(r.ast.filename).toBe('a.ts');
    expect(r.ast.language).toBe('ts');
    expect(r.ast.body.length).toBe(1);
  });

  // T053-test #6: WASM integrity errors propagate as thrown
  // FugaziParseError, NOT as fail-soft entries in errors[].
  it('propagates FugaziParseError(WASM_INTEGRITY) — never wraps it as a ScanError', async () => {
    __setManifestForTest({
      blobs: { swc: { path: 'node_modules/@swc/wasm/wasm_bg.wasm', sha256: '0'.repeat(64) } },
    });
    __clearWasmCacheForTest();

    let caught: unknown;
    try {
      await scanFile('a.ts', 'const x = 1;');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_INTEGRITY');
  });
});

describe('ScanErrorAggregator', () => {
  function pf(file: string, line: number, column: number): ParseFailedScanError {
    return {
      kind: 'parse_failed',
      file,
      position: { line, column, byteOffset: 0 },
      message: `${file}:${line}:${column}`,
      code: 'PARSE_SYNTAX_ERROR',
    };
  }

  function unsup(file: string): UnsupportedLanguageScanError {
    return {
      kind: 'unsupported_language',
      file,
      extension: '.x',
      message: unsupportedLanguageMessage(file, '.x'),
    };
  }

  function io(file: string): IoScanError {
    return {
      kind: 'io',
      file,
      code: 'FS_PATH_NOT_FOUND',
      message: pathNotFoundMessage(file),
    };
  }

  // T053-test #7: deterministic sort by (file, kind-priority, line, column).
  it('drain() returns a deterministically sorted snapshot', () => {
    const agg = new ScanErrorAggregator();
    // Insert in scrambled order across files and kinds.
    agg.add(pf('c.ts', 5, 0));
    agg.add(io('a.ts'));
    agg.add(pf('b.ts', 2, 1));
    agg.add(pf('a.ts', 1, 0));
    agg.add(unsup('a.ts'));
    agg.add(pf('a.ts', 1, 4));
    agg.add(pf('a.ts', 3, 0));

    const sorted = agg.drain();
    // Expected order: a.ts(parse 1:0) < a.ts(parse 1:4) < a.ts(parse 3:0) <
    //                 a.ts(unsup) < a.ts(io) < b.ts(parse 2:1) < c.ts(parse 5:0).
    expect(sorted.map((e) => `${e.file}|${e.kind}|${describeLineCol(e)}`)).toEqual([
      'a.ts|parse_failed|1:0',
      'a.ts|parse_failed|1:4',
      'a.ts|parse_failed|3:0',
      'a.ts|unsupported_language|-',
      'a.ts|io|-',
      'b.ts|parse_failed|2:1',
      'c.ts|parse_failed|5:0',
    ]);
  });

  // T053-test #8: count() + clear() semantics.
  it('count() reflects insertions; drain() does NOT decrement; clear() empties', () => {
    const agg = new ScanErrorAggregator();
    expect(agg.count()).toBe(0);
    agg.add(pf('a.ts', 1, 0));
    agg.add(pf('a.ts', 2, 0));
    agg.addMany([pf('b.ts', 1, 0), unsup('c.ts')]);
    expect(agg.count()).toBe(4);

    const drained = agg.drain();
    expect(drained.length).toBe(4);
    expect(agg.count()).toBe(4);

    agg.clear();
    expect(agg.count()).toBe(0);
    expect(agg.drain()).toEqual([]);

    agg.add(pf('a.ts', 1, 0));
    expect(agg.count()).toBe(1);
  });

  // T053-test #9: drain idempotence — two consecutive drains are deep-equal.
  it('two consecutive drain() calls return arrays with EQUAL contents', () => {
    const agg = new ScanErrorAggregator();
    agg.add(pf('b.ts', 4, 2));
    agg.add(pf('a.ts', 1, 1));
    agg.add(io('z.ts'));

    const a = agg.drain();
    const b = agg.drain();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // And drain returns a NEW array each call.
    expect(a).not.toBe(b);
  });

  it('addMany([]) is a no-op', () => {
    const agg = new ScanErrorAggregator();
    agg.addMany([]);
    expect(agg.count()).toBe(0);
    expect(agg.drain()).toEqual([]);
  });
});

// Helper for the sort assertion table.
function describeLineCol(e: ScanError): string {
  if (e.kind === 'parse_failed') return `${e.position.line}:${e.position.column}`;
  return '-';
}
