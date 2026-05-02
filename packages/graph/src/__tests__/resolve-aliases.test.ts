/**
 * resolve-aliases.test.ts — T083 / T084 acceptance suite.
 *
 * Covers the built-in alias resolver and the tsconfig.json `paths` resolver:
 *   1. `~/foo` -> projectRoot/foo
 *   2. `@/foo` -> projectRoot/foo (Vite-style)
 *   3. `#internal/foo` -> projectRoot/internal/foo
 *   4. `~~/foo` longer prefix wins over `~/foo`
 *   5. user override replaces a built-in
 *   6. tsconfig.json simple `paths` mapping
 *   7. tsconfig.json wildcard pattern (`@app/*`)
 *   8. tsconfig.json longest-pattern-wins (`@app/utils/*` beats `@app/*`)
 *   9. tsconfig.json multiple roots — first existing wins
 *  10. tsconfig.json with comments + trailing commas
 *  11. tsconfig.json walks up from importer
 *  12. tsconfig.json with no `paths` returns null
 */

import { afterEach, describe, expect, it } from 'vitest';
import { matchesAliasPrefix, resolveAlias } from '../resolve/alias.js';
import { createMemoryFsAdapter } from '../resolve/fs-adapter.js';
import { __clearTsconfigCacheForTest, resolveTsconfigPaths } from '../resolve/tsconfig-paths.js';

afterEach(() => {
  __clearTsconfigCacheForTest();
});

describe('resolveAlias', () => {
  it('resolves ~/foo to projectRoot/foo', () => {
    const fs = createMemoryFsAdapter({ '/proj/foo.ts': '' });
    expect(resolveAlias('~/foo', '/proj', undefined, fs)).toBe('/proj/foo.ts');
  });

  it('resolves @/foo to projectRoot/foo', () => {
    const fs = createMemoryFsAdapter({ '/proj/components/Button.tsx': '' });
    expect(resolveAlias('@/components/Button', '/proj', undefined, fs)).toBe(
      '/proj/components/Button.tsx',
    );
  });

  it('resolves #internal/foo to projectRoot/internal/foo', () => {
    const fs = createMemoryFsAdapter({ '/proj/internal/util.ts': '' });
    expect(resolveAlias('#internal/util', '/proj', undefined, fs)).toBe('/proj/internal/util.ts');
  });

  it('uses the longer prefix when both ~/ and ~~/ would match', () => {
    // `~~/x` must NOT be cropped to `~/~/x`. With the default table both keys
    // map to projectRoot, but the longer prefix is what gets stripped.
    const fs = createMemoryFsAdapter({
      '/proj/x.ts': '',
      '/proj/sub/x.ts': '',
    });
    expect(resolveAlias('~~/sub/x', '/proj', undefined, fs)).toBe('/proj/sub/x.ts');
  });

  it('honors a user-supplied alias override', () => {
    const fs = createMemoryFsAdapter({ '/proj/lib/util.ts': '' });
    expect(resolveAlias('$lib/util', '/proj', { '$lib/': 'lib' }, fs)).toBe('/proj/lib/util.ts');
  });

  it('returns null when alias prefix matches but target is missing', () => {
    const fs = createMemoryFsAdapter({ '/proj/foo.ts': '' });
    expect(resolveAlias('@/missing', '/proj', undefined, fs)).toBeNull();
  });

  it('matchesAliasPrefix detects built-in and override prefixes', () => {
    expect(matchesAliasPrefix('@/foo', undefined)).toBe(true);
    expect(matchesAliasPrefix('~/foo', undefined)).toBe(true);
    expect(matchesAliasPrefix('#internal/foo', undefined)).toBe(true);
    expect(matchesAliasPrefix('react', undefined)).toBe(false);
    expect(matchesAliasPrefix('$lib/foo', { '$lib/': 'lib' })).toBe(true);
  });
});

describe('resolveTsconfigPaths (pre-parsed)', () => {
  it('matches a simple non-wildcard mapping', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/util.ts': '' });
    const paths = new Map<string, readonly string[]>([['shared', ['./src/util']]]);
    expect(
      resolveTsconfigPaths('shared', '/proj/src/index.ts', fs, {
        baseUrl: '/proj',
        paths,
      }),
    ).toBe('/proj/src/util.ts');
  });

  it('matches a wildcard pattern', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/components/Button.tsx': '' });
    const paths = new Map<string, readonly string[]>([['@app/*', ['./src/*']]]);
    expect(
      resolveTsconfigPaths('@app/components/Button', '/proj/src/index.ts', fs, {
        baseUrl: '/proj',
        paths,
      }),
    ).toBe('/proj/src/components/Button.tsx');
  });

  it('chooses the longest matching pattern', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/foo.ts': '',
      '/proj/src/utils/bar.ts': '',
      '/proj/special/utils/bar.ts': '',
    });
    const paths = new Map<string, readonly string[]>([
      ['@app/*', ['./src/*']],
      ['@app/utils/*', ['./special/utils/*']],
    ]);
    expect(
      resolveTsconfigPaths('@app/utils/bar', '/proj/src/index.ts', fs, {
        baseUrl: '/proj',
        paths,
      }),
    ).toBe('/proj/special/utils/bar.ts');
  });

  it('falls through multiple roots until one exists', () => {
    const fs = createMemoryFsAdapter({ '/proj/secondary/util.ts': '' });
    const paths = new Map<string, readonly string[]>([
      ['shared/*', ['./primary/*', './secondary/*']],
    ]);
    expect(
      resolveTsconfigPaths('shared/util', '/proj/src/index.ts', fs, {
        baseUrl: '/proj',
        paths,
      }),
    ).toBe('/proj/secondary/util.ts');
  });
});

describe('resolveTsconfigPaths (filesystem-discovered)', () => {
  it('parses a tsconfig with comments and trailing commas', () => {
    const tsconfig = `{
      // top-level comment
      "compilerOptions": {
        /* block */
        "baseUrl": ".",
        "paths": {
          "@/*": ["src/*"],
        },
      },
    }`;
    const fs = createMemoryFsAdapter({
      '/proj/tsconfig.json': tsconfig,
      '/proj/src/index.ts': '',
      '/proj/src/Foo.ts': '',
    });
    expect(resolveTsconfigPaths('@/Foo', '/proj/src/index.ts', fs)).toBe('/proj/src/Foo.ts');
  });

  it('walks up from importer to find the nearest tsconfig.json', () => {
    const tsconfig = '{"compilerOptions":{"baseUrl":".","paths":{"~/*":["lib/*"]}}}';
    const fs = createMemoryFsAdapter({
      '/proj/tsconfig.json': tsconfig,
      '/proj/lib/util.ts': '',
      '/proj/apps/web/src/index.ts': '',
    });
    expect(resolveTsconfigPaths('~/util', '/proj/apps/web/src/index.ts', fs)).toBe(
      '/proj/lib/util.ts',
    );
  });

  it('returns null when tsconfig has no paths config', () => {
    const fs = createMemoryFsAdapter({
      '/proj/tsconfig.json': '{"compilerOptions":{"strict":true}}',
      '/proj/src/index.ts': '',
    });
    expect(resolveTsconfigPaths('@/foo', '/proj/src/index.ts', fs)).toBeNull();
  });

  it('returns null when no tsconfig is anywhere up the tree', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/index.ts': '' });
    expect(resolveTsconfigPaths('@/foo', '/proj/src/index.ts', fs)).toBeNull();
  });
});
