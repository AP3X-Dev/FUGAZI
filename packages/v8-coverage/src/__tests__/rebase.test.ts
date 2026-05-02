/**
 * rebase.test.ts — Phase 3e (T115) — coverage-root URL rebase fixtures.
 *
 * Six fixtures: docker→host substitution, forward-slash output enforcement,
 * drive-letter folding, unmapped warning capture, identity rebase, exact-prefix
 * edge case.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { rebaseCoverage } from '../rebase.js';
import type { ScriptCoverage } from '../types.js';

const f = (url: string, scriptId = '1'): ScriptCoverage => ({
  scriptId,
  url,
  functions: [],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rebaseCoverage — docker /app → host substitution', () => {
  it('replaces /app prefix with host workspace prefix', () => {
    const out = rebaseCoverage([f('file:///app/src/index.js')], {
      fromPrefix: 'file:///app',
      toPrefix: 'file:///Users/me/project',
    });
    expect(out[0]?.url).toBe('file:///Users/me/project/src/index.js');
    expect(out[0]?.unmapped).toBeUndefined();
  });
});

describe('rebaseCoverage — forward-slash output after Windows path', () => {
  it('converts backslashes in the to-prefix output', () => {
    const out = rebaseCoverage([f('C:\\repo\\src\\a.js')], {
      fromPrefix: 'C:\\repo',
      toPrefix: 'D:\\dest',
    });
    expect(out[0]?.url).toBe('D:/dest/src/a.js');
  });
});

describe('rebaseCoverage — drive-letter folding on Windows', () => {
  it('uppercases lowercase drive letters', () => {
    const out = rebaseCoverage([f('file:///c:/repo/src/a.js')], {
      fromPrefix: 'file:///c:/repo',
      toPrefix: 'file:///d:/dest',
    });
    expect(out[0]?.url).toBe('file:///D:/dest/src/a.js');
  });

  it('uppercases bare drive paths', () => {
    const out = rebaseCoverage([f('c:/repo/a.js')], { fromPrefix: 'c:/repo', toPrefix: 'd:/dest' });
    expect(out[0]?.url).toBe('D:/dest/a.js');
  });
});

describe('rebaseCoverage — prefix not matched → unmapped + warning', () => {
  it('emits the verbatim warning string and flags entry unmapped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = rebaseCoverage([f('file:///other/x.js')], {
      fromPrefix: 'file:///app',
      toPrefix: 'file:///Users/me/project',
    });
    expect(out[0]?.unmapped).toBe(true);
    expect(out[0]?.url).toBe('file:///other/x.js');
    expect(warnSpy).toHaveBeenCalledWith(
      "v8-coverage: coverage-root prefix 'file:///app' did not match URL 'file:///other/x.js'; entry kept unmapped",
    );
  });
});

describe('rebaseCoverage — empty fromPrefix → identity', () => {
  it('returns scripts with normalized URL but unchanged path', () => {
    const out = rebaseCoverage([f('file:///c:/repo/a.js')], { fromPrefix: '', toPrefix: 'unused' });
    // Drive letter folding still applies via normalizeUrl.
    expect(out[0]?.url).toBe('file:///C:/repo/a.js');
    expect(out[0]?.unmapped).toBeUndefined();
  });
});

describe('rebaseCoverage — URL exactly equals fromPrefix', () => {
  it('emits exactly toPrefix', () => {
    const out = rebaseCoverage([f('file:///app')], {
      fromPrefix: 'file:///app',
      toPrefix: 'file:///Users/me/project',
    });
    expect(out[0]?.url).toBe('file:///Users/me/project');
  });
});
