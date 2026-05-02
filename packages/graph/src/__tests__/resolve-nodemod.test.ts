/**
 * resolve-nodemod.test.ts — T085 / T086 acceptance suite.
 *
 * Covers:
 *   1. simple bare package (react -> node_modules/react/index.js)
 *   2. main field fallback
 *   3. module field preferred over main
 *   4. exports string (`"exports": "./esm/index.js"`)
 *   5. exports condition object — first matching wins (declaration order)
 *   6. exports subpath map
 *   7. exports subpath pattern (`"./*": "./src/*"`)
 *   8. nested condition matching (`{ node: { import: "..." } }`)
 *   9. scoped package (@scope/pkg)
 *  10. deep import without exports — falls through to file probing
 *  11. missing package -> null
 *  12. ancestor walk (deep file finds node_modules at root)
 *  13. configurable condition order
 *  14. exports default condition fallback
 *  15. exports unmatched subpath returns null after fall-through
 *  16. splitBareSpecifier edge cases
 */

import { afterEach, describe, expect, it } from 'vitest';
import { resolveExports } from '../resolve/exports-conditions.js';
import { createMemoryFsAdapter } from '../resolve/fs-adapter.js';
import {
  __clearPackageJsonCacheForTest,
  resolveNodeModules,
  splitBareSpecifier,
} from '../resolve/node-modules.js';

afterEach(() => {
  __clearPackageJsonCacheForTest();
});

describe('splitBareSpecifier', () => {
  it('returns "." subpath for bare package', () => {
    expect(splitBareSpecifier('react')).toEqual({ name: 'react', subpath: '.' });
  });
  it('preserves deep subpath', () => {
    expect(splitBareSpecifier('react/useFoo')).toEqual({
      name: 'react',
      subpath: './useFoo',
    });
  });
  it('keeps scoped name as a single unit', () => {
    expect(splitBareSpecifier('@scope/pkg')).toEqual({
      name: '@scope/pkg',
      subpath: '.',
    });
  });
  it('extracts deep subpath under scoped name', () => {
    expect(splitBareSpecifier('@scope/pkg/sub/path')).toEqual({
      name: '@scope/pkg',
      subpath: './sub/path',
    });
  });
});

describe('resolveExports', () => {
  it('matches a string exports value to the package root', () => {
    expect(resolveExports('./esm/index.js', '.', ['default'])).toBe('./esm/index.js');
  });
  it('returns null for a deep subpath against a string exports', () => {
    expect(resolveExports('./esm/index.js', './sub', ['default'])).toBeNull();
  });
  it('selects the first matching condition in declaration order', () => {
    const exp = { import: './esm/x.js', require: './cjs/x.js', default: './x.js' };
    expect(resolveExports(exp, '.', ['import'])).toBe('./esm/x.js');
    expect(resolveExports(exp, '.', ['require'])).toBe('./cjs/x.js');
  });
  it('falls back to default when no other condition matches', () => {
    const exp = { import: './esm/x.js', default: './x.js' };
    expect(resolveExports(exp, '.', ['unmatched-condition'])).toBe('./x.js');
  });
  it('matches a subpath pattern with wildcard', () => {
    const exp = { './*': './src/*.js' };
    expect(resolveExports(exp, './foo', ['default'])).toBe('./src/foo.js');
  });
  it('walks nested condition objects', () => {
    const exp = { node: { import: './esm/x.js' } };
    expect(resolveExports(exp, '.', ['node', 'import'])).toBe('./esm/x.js');
  });
  it('returns null when no key matches', () => {
    const exp = { './a': './a.js' };
    expect(resolveExports(exp, './b', ['default'])).toBeNull();
  });
});

describe('resolveNodeModules', () => {
  it('finds a sibling node_modules package via main field', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/react/package.json': '{"main":"./index.js"}',
      '/proj/node_modules/react/index.js': '',
    });
    expect(resolveNodeModules('react', '/proj/src/index.ts', undefined, fs)).toBe(
      '/proj/node_modules/react/index.js',
    );
  });

  it('prefers module over main when both are present', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': '{"main":"./cjs/x.cjs","module":"./esm/x.mjs"}',
      '/proj/node_modules/lib/cjs/x.cjs': '',
      '/proj/node_modules/lib/esm/x.mjs': '',
    });
    expect(resolveNodeModules('lib', '/proj/src/index.ts', undefined, fs)).toBe(
      '/proj/node_modules/lib/esm/x.mjs',
    );
  });

  it('honors a string exports field', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': '{"exports":"./out/main.js"}',
      '/proj/node_modules/lib/out/main.js': '',
    });
    expect(resolveNodeModules('lib', '/proj/src/index.ts', undefined, fs)).toBe(
      '/proj/node_modules/lib/out/main.js',
    );
  });

  it('honors an exports condition object in declaration order', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': JSON.stringify({
        exports: { import: './esm/x.js', require: './cjs/x.js' },
      }),
      '/proj/node_modules/lib/esm/x.js': '',
      '/proj/node_modules/lib/cjs/x.js': '',
    });
    expect(resolveNodeModules('lib', '/proj/src/index.ts', ['import'], fs)).toBe(
      '/proj/node_modules/lib/esm/x.js',
    );
    expect(resolveNodeModules('lib', '/proj/src/index.ts', ['require'], fs)).toBe(
      '/proj/node_modules/lib/cjs/x.js',
    );
  });

  it('matches an exports subpath map', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': JSON.stringify({
        exports: { '.': './main.js', './sub': './out/sub.js' },
      }),
      '/proj/node_modules/lib/main.js': '',
      '/proj/node_modules/lib/out/sub.js': '',
    });
    expect(resolveNodeModules('lib/sub', '/proj/src/index.ts', undefined, fs)).toBe(
      '/proj/node_modules/lib/out/sub.js',
    );
  });

  it('matches an exports subpath pattern', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': JSON.stringify({
        exports: { './*': './src/*.js' },
      }),
      '/proj/node_modules/lib/src/foo.js': '',
    });
    expect(resolveNodeModules('lib/foo', '/proj/src/index.ts', undefined, fs)).toBe(
      '/proj/node_modules/lib/src/foo.js',
    );
  });

  it('walks nested condition objects', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': JSON.stringify({
        exports: { node: { import: './esm/x.js' } },
      }),
      '/proj/node_modules/lib/esm/x.js': '',
    });
    expect(resolveNodeModules('lib', '/proj/src/index.ts', ['node', 'import'], fs)).toBe(
      '/proj/node_modules/lib/esm/x.js',
    );
  });

  it('resolves a scoped package', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/@scope/pkg/package.json': '{"main":"./index.js"}',
      '/proj/node_modules/@scope/pkg/index.js': '',
    });
    expect(resolveNodeModules('@scope/pkg', '/proj/src/index.ts', undefined, fs)).toBe(
      '/proj/node_modules/@scope/pkg/index.js',
    );
  });

  it('falls through to deep import probing when no exports match', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': '{"main":"./index.js"}',
      '/proj/node_modules/lib/index.js': '',
      '/proj/node_modules/lib/utils/inner.js': '',
    });
    expect(resolveNodeModules('lib/utils/inner', '/proj/src/index.ts', undefined, fs)).toBe(
      '/proj/node_modules/lib/utils/inner.js',
    );
  });

  it('returns null for a missing package', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/index.ts': '' });
    expect(resolveNodeModules('react', '/proj/src/index.ts', undefined, fs)).toBeNull();
  });

  it('walks ancestor directories until node_modules is found', () => {
    const fs = createMemoryFsAdapter({
      '/proj/apps/web/src/deep/file.ts': '',
      '/proj/node_modules/lodash/package.json': '{"main":"./index.js"}',
      '/proj/node_modules/lodash/index.js': '',
    });
    expect(resolveNodeModules('lodash', '/proj/apps/web/src/deep/file.ts', undefined, fs)).toBe(
      '/proj/node_modules/lodash/index.js',
    );
  });

  it('uses configurable condition order', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': JSON.stringify({
        exports: {
          import: './esm/x.js',
          require: './cjs/x.js',
          default: './fallback.js',
        },
      }),
      '/proj/node_modules/lib/esm/x.js': '',
      '/proj/node_modules/lib/cjs/x.js': '',
      '/proj/node_modules/lib/fallback.js': '',
    });
    // Active set has neither import nor require -> default wins.
    expect(resolveNodeModules('lib', '/proj/src/index.ts', ['browser'], fs)).toBe(
      '/proj/node_modules/lib/fallback.js',
    );
  });

  it('returns the index.<ext> when no main and no exports are present', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': '{}',
      '/proj/node_modules/lib/index.js': '',
    });
    expect(resolveNodeModules('lib', '/proj/src/index.ts', undefined, fs)).toBe(
      '/proj/node_modules/lib/index.js',
    );
  });

  it('returns null when exports is set but file is absent on disk', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lib/package.json': '{"exports":"./missing.js"}',
    });
    expect(resolveNodeModules('lib', '/proj/src/index.ts', undefined, fs)).toBeNull();
  });
});
