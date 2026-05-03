/**
 * detect.test.ts — plugin activation contract tests.
 */

import { describe, expect, it } from 'vitest';
import {
  collectDependencyNames,
  detectActivePlugins,
  evaluateDetection,
  isPluginActive,
  matchesEnabler,
} from '../detect.js';
import type { PluginDef } from '../types.js';

const mkPlugin = (overrides: Partial<PluginDef>): PluginDef =>
  Object.freeze({
    name: 'test',
    enablers: [],
    entryPoints: [],
    entryPointRole: 'support' as const,
    configPatterns: [],
    alwaysUsed: [],
    toolingDependencies: [],
    usedExports: [],
    usedClassMembers: [],
    packageManager: 'auto' as const,
    usedDecorators: [],
    ...overrides,
  });

describe('collectDependencyNames', () => {
  it('returns empty set for an empty package', () => {
    expect(collectDependencyNames({}).size).toBe(0);
  });
  it('includes dependencies', () => {
    const set = collectDependencyNames({ dependencies: { react: '^18' } });
    expect(set.has('react')).toBe(true);
  });
  it('includes devDependencies', () => {
    const set = collectDependencyNames({ devDependencies: { vitest: '^2' } });
    expect(set.has('vitest')).toBe(true);
  });
  it('includes peerDependencies', () => {
    const set = collectDependencyNames({ peerDependencies: { react: '*' } });
    expect(set.has('react')).toBe(true);
  });
  it('unions all three', () => {
    const set = collectDependencyNames({
      dependencies: { a: '1' },
      devDependencies: { b: '1' },
      peerDependencies: { c: '1' },
    });
    expect(set.size).toBe(3);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(true);
  });
});

describe('matchesEnabler', () => {
  it('matches an exact dependency name', () => {
    const deps = new Set(['next']);
    expect(matchesEnabler('next', deps)).toBe(true);
  });
  it('does not match a different name', () => {
    const deps = new Set(['react']);
    expect(matchesEnabler('next', deps)).toBe(false);
  });
  it('matches a prefix enabler', () => {
    const deps = new Set(['@storybook/react']);
    expect(matchesEnabler('@storybook/', deps)).toBe(true);
  });
  it('does not match a prefix when no slash', () => {
    const deps = new Set(['@storybookish']);
    expect(matchesEnabler('@storybook/', deps)).toBe(false);
  });
});

describe('evaluateDetection', () => {
  const ctx = {
    pkg: { dependencies: { next: '^14' } },
    files: ['next.config.ts', 'src/page.tsx'],
  };

  it('dependency rule — matches', () => {
    expect(evaluateDetection({ type: 'dependency', package: 'next' }, ctx)).toBe(true);
  });
  it('dependency rule — no match', () => {
    expect(evaluateDetection({ type: 'dependency', package: 'react' }, ctx)).toBe(false);
  });
  it('fileExists rule — matches glob', () => {
    expect(evaluateDetection({ type: 'fileExists', pattern: 'next.config.{ts,js}' }, ctx)).toBe(
      true,
    );
  });
  it('fileExists rule — no match', () => {
    expect(evaluateDetection({ type: 'fileExists', pattern: 'astro.config.ts' }, ctx)).toBe(false);
  });
  it('all combinator — all true', () => {
    expect(
      evaluateDetection(
        {
          type: 'all',
          conditions: [
            { type: 'dependency', package: 'next' },
            { type: 'fileExists', pattern: 'next.config.{ts,js}' },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });
  it('all combinator — one false', () => {
    expect(
      evaluateDetection(
        {
          type: 'all',
          conditions: [
            { type: 'dependency', package: 'next' },
            { type: 'dependency', package: 'react' },
          ],
        },
        ctx,
      ),
    ).toBe(false);
  });
  it('all combinator — empty list (vacuous true)', () => {
    expect(evaluateDetection({ type: 'all', conditions: [] }, ctx)).toBe(true);
  });
  it('any combinator — first true', () => {
    expect(
      evaluateDetection(
        {
          type: 'any',
          conditions: [
            { type: 'dependency', package: 'next' },
            { type: 'dependency', package: 'react' },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });
  it('any combinator — none true', () => {
    expect(
      evaluateDetection(
        {
          type: 'any',
          conditions: [
            { type: 'dependency', package: 'react' },
            { type: 'dependency', package: 'preact' },
          ],
        },
        ctx,
      ),
    ).toBe(false);
  });
  it('any combinator — empty list (vacuous false)', () => {
    expect(evaluateDetection({ type: 'any', conditions: [] }, ctx)).toBe(false);
  });
  it('nested combinators — all over any', () => {
    expect(
      evaluateDetection(
        {
          type: 'all',
          conditions: [
            {
              type: 'any',
              conditions: [
                { type: 'dependency', package: 'react' },
                { type: 'dependency', package: 'next' },
              ],
            },
            { type: 'fileExists', pattern: 'src/*.tsx' },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });
});

describe('isPluginActive', () => {
  it('falls back to enablers when detection is absent', () => {
    const p = mkPlugin({ enablers: ['next'] });
    expect(
      isPluginActive(p, {
        pkg: { dependencies: { next: '^14' } },
        files: [],
      }),
    ).toBe(true);
  });
  it('uses detection when set, ignoring enablers', () => {
    const p = mkPlugin({
      enablers: ['next'],
      detection: { type: 'fileExists', pattern: 'astro.config.ts' },
    });
    expect(
      isPluginActive(p, {
        pkg: { dependencies: { next: '^14' } },
        files: [],
      }),
    ).toBe(false);
  });
  it('returns false when neither detection nor enablers match', () => {
    const p = mkPlugin({ enablers: ['next'] });
    expect(isPluginActive(p, { pkg: { dependencies: {} }, files: [] })).toBe(false);
  });
  it('returns false when both are missing', () => {
    const p = mkPlugin({});
    expect(isPluginActive(p, { pkg: { dependencies: { next: '*' } }, files: [] })).toBe(false);
  });
  it('checks every enabler when multiple are set', () => {
    const p = mkPlugin({ enablers: ['vue', 'react', 'preact'] });
    expect(isPluginActive(p, { pkg: { dependencies: { preact: '*' } }, files: [] })).toBe(true);
  });
});

describe('detectActivePlugins', () => {
  it('returns empty when no plugin matches', () => {
    const a = mkPlugin({ name: 'a', enablers: ['foo'] });
    const b = mkPlugin({ name: 'b', enablers: ['bar'] });
    const result = detectActivePlugins([a, b], {
      pkg: { dependencies: {} },
      files: [],
    });
    expect(result).toHaveLength(0);
  });
  it('returns matching plugins in input order', () => {
    const a = mkPlugin({ name: 'a', enablers: ['foo'] });
    const b = mkPlugin({ name: 'b', enablers: ['bar'] });
    const c = mkPlugin({ name: 'c', enablers: ['baz'] });
    const result = detectActivePlugins([a, b, c], {
      pkg: { dependencies: { foo: '*', baz: '*' } },
      files: [],
    });
    expect(result.map((p) => p.name)).toEqual(['a', 'c']);
  });
  it('result is frozen', () => {
    const result = detectActivePlugins([], {
      pkg: { dependencies: {} },
      files: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* Phase 4d T347 — Python-manifest activation paths                         */
/* ------------------------------------------------------------------------ */

const pyManifest = (
  runtime: readonly string[],
  dev: readonly string[] = [],
): { runtime: ReadonlySet<string>; dev: ReadonlySet<string> } => ({
  runtime: new Set(runtime),
  dev: new Set(dev),
});

describe('Phase 4d T347 — packageManager-aware activation', () => {
  it('packageManager:pip plugin activates from pyproject.toml deps', () => {
    const p = mkPlugin({ name: 'django', packageManager: 'pip', enablers: ['django'] });
    expect(
      isPluginActive(p, {
        pkg: {},
        files: [],
        pyManifest: pyManifest(['django']),
      }),
    ).toBe(true);
  });

  it('packageManager:pip plugin does NOT activate from package.json deps', () => {
    const p = mkPlugin({ name: 'django', packageManager: 'pip', enablers: ['django'] });
    expect(
      isPluginActive(p, {
        pkg: { dependencies: { django: '^4.0' } },
        files: [],
      }),
    ).toBe(false);
  });

  it('packageManager:poetry plugin activates from python manifest', () => {
    const p = mkPlugin({ name: 'pytest', packageManager: 'poetry', enablers: ['pytest'] });
    expect(
      isPluginActive(p, {
        pkg: {},
        files: [],
        pyManifest: pyManifest([], ['pytest']),
      }),
    ).toBe(true);
  });

  it('packageManager:uv plugin activates from python manifest', () => {
    const p = mkPlugin({ name: 'ruff', packageManager: 'uv', enablers: ['ruff'] });
    expect(
      isPluginActive(p, {
        pkg: {},
        files: [],
        pyManifest: pyManifest(['ruff']),
      }),
    ).toBe(true);
  });

  it('packageManager:npm plugin does NOT activate from python manifest', () => {
    const p = mkPlugin({ name: 'vitest', packageManager: 'npm', enablers: ['vitest'] });
    expect(
      isPluginActive(p, {
        pkg: {},
        files: [],
        pyManifest: pyManifest(['vitest']),
      }),
    ).toBe(false);
  });

  it('packageManager:auto plugin activates from EITHER manifest (pkg)', () => {
    const p = mkPlugin({ name: 'auto', packageManager: 'auto', enablers: ['react'] });
    expect(
      isPluginActive(p, {
        pkg: { dependencies: { react: '^19' } },
        files: [],
      }),
    ).toBe(true);
  });

  it('packageManager:auto plugin activates from EITHER manifest (python)', () => {
    const p = mkPlugin({ name: 'auto', packageManager: 'auto', enablers: ['flask'] });
    expect(
      isPluginActive(p, {
        pkg: {},
        files: [],
        pyManifest: pyManifest(['flask']),
      }),
    ).toBe(true);
  });

  it('Python plugin matches PEP 503-normalized name (sqlalchemy ↔ SQLAlchemy)', () => {
    const p = mkPlugin({ name: 'sqlalchemy', packageManager: 'pip', enablers: ['SQLAlchemy'] });
    expect(
      isPluginActive(p, {
        pkg: {},
        files: [],
        pyManifest: pyManifest(['sqlalchemy']),
      }),
    ).toBe(true);
  });

  it('Python plugin matches PEP 503-normalized name (tortoise-orm ↔ tortoise_orm)', () => {
    const p = mkPlugin({ name: 'tortoise', packageManager: 'pip', enablers: ['tortoise_orm'] });
    expect(
      isPluginActive(p, {
        pkg: {},
        files: [],
        pyManifest: pyManifest(['tortoise-orm']),
      }),
    ).toBe(true);
  });

  it('packageManager:pip plugin without pyManifest is silently inactive', () => {
    const p = mkPlugin({ name: 'django', packageManager: 'pip', enablers: ['django'] });
    expect(isPluginActive(p, { pkg: {}, files: [] })).toBe(false);
  });

  it('detection rule (dependency type) checks both pkg AND python manifest', () => {
    const p = mkPlugin({
      name: 'auto',
      detection: { type: 'dependency', package: 'fastapi' },
    });
    expect(
      isPluginActive(p, {
        pkg: {},
        files: [],
        pyManifest: pyManifest(['fastapi']),
      }),
    ).toBe(true);
    expect(
      isPluginActive(p, {
        pkg: { dependencies: { fastapi: '^0.100' } },
        files: [],
      }),
    ).toBe(true);
  });
});
