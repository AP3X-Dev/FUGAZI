/**
 * coverage-rebase.test.ts — Phase 3g Wave B acceptance suite for
 * `rebaseCoverageAuto` (explicit + auto-detection paths).
 */

import type { ScriptCoverage } from '@fugazi/v8-coverage';
import { describe, expect, it, vi } from 'vitest';
import { rebaseCoverageAuto } from '../coverage-rebase.js';

function script(url: string): ScriptCoverage {
  return { scriptId: '1', url, functions: [] };
}

describe('rebaseCoverageAuto — explicit mapping', () => {
  it('passes from/to straight to rebaseCoverage', () => {
    const out = rebaseCoverageAuto([script('/app/src/a.ts'), script('/app/src/b.ts')], {
      mode: { from: '/app/', to: '/Users/me/proj/' },
      projectRoot: '/Users/me/proj',
    });
    expect(out[0]?.url).toBe('/Users/me/proj/src/a.ts');
    expect(out[1]?.url).toBe('/Users/me/proj/src/b.ts');
  });

  it('explicit mismatch retains entries flagged unmapped (warn surfaced)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const out = rebaseCoverageAuto([script('/elsewhere/x.ts')], {
        mode: { from: '/app/', to: '/proj/' },
        projectRoot: '/proj',
      });
      expect(out[0]?.unmapped).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('rebaseCoverageAuto — auto detection', () => {
  it('finds longest common prefix and rebases', () => {
    const out = rebaseCoverageAuto(
      [
        script('/runner/work/proj/src/a.ts'),
        script('/runner/work/proj/src/b.ts'),
        script('/runner/work/proj/lib/c.ts'),
      ],
      {
        mode: 'auto',
        projectRoot: '/Users/me/code/proj',
        modules: new Set([
          '/Users/me/code/proj/src/a.ts',
          '/Users/me/code/proj/src/b.ts',
          '/Users/me/code/proj/lib/c.ts',
        ]),
      },
    );
    // All three should have rebased to under the project prefix.
    for (const s of out) {
      expect(s.url.startsWith('/Users/me/code/proj/')).toBe(true);
      expect(s.unmapped).toBeUndefined();
    }
  });

  it('throws COVERAGE_REBASE_AMBIGUOUS with verbatim message when no common prefix', () => {
    expect(() =>
      rebaseCoverageAuto([script('alpha.ts'), script('beta.ts'), script('gamma.ts')], {
        mode: 'auto',
        projectRoot: '/proj',
      }),
    ).toThrowError(
      '--coverage-root auto: cannot determine unambiguous mapping (matched 0 of 3 paths)',
    );
  });

  it('verbatim error format: <N> matches reflects actual matched count', () => {
    // Only one of three shares a prefix → matched < 50% threshold → throws.
    try {
      rebaseCoverageAuto(
        [script('/proj/a.ts'), script('/elsewhere/b.ts'), script('different/c.ts')],
        { mode: 'auto', projectRoot: '/proj' },
      );
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/matched \d+ of 3 paths/);
    }
  });

  it('empty input → empty output (no throw, no detection)', () => {
    const out = rebaseCoverageAuto([], { mode: 'auto', projectRoot: '/proj' });
    expect(out).toEqual([]);
  });
});
