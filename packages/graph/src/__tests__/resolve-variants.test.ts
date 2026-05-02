/**
 * resolve-variants.test.ts — T087 / T088 acceptance suite.
 *
 * Covers: require, dynamic, react-native, fallbacks.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { resolveDynamic } from '../resolve/dynamic.js';
import { tryOutputToSourceFallback, tryWideIndexProbe } from '../resolve/fallbacks.js';
import { createMemoryFsAdapter } from '../resolve/fs-adapter.js';
import { __clearPackageJsonCacheForTest } from '../resolve/node-modules.js';
import { resolveReactNative } from '../resolve/react-native.js';
import { resolveRequire } from '../resolve/require.js';

afterEach(() => {
  __clearPackageJsonCacheForTest();
});

// ---------------------------------------------------------------------------
// resolveRequire
// ---------------------------------------------------------------------------

describe('resolveRequire', () => {
  it('resolves a relative require like a static import', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/foo.ts': '',
    });
    expect(resolveRequire('./foo', '/proj/src/index.ts', { projectRoot: '/proj', fs })).toBe(
      '/proj/src/foo.ts',
    );
  });

  it('resolves a bare require via node_modules', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lodash/package.json': '{"main":"./index.js"}',
      '/proj/node_modules/lodash/index.js': '',
    });
    expect(resolveRequire('lodash', '/proj/src/index.ts', { projectRoot: '/proj', fs })).toBe(
      '/proj/node_modules/lodash/index.js',
    );
  });

  it('honors built-in aliases on require()', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/lib/util.ts': '',
    });
    expect(resolveRequire('@/lib/util', '/proj/src/index.ts', { projectRoot: '/proj', fs })).toBe(
      '/proj/lib/util.ts',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveDynamic
// ---------------------------------------------------------------------------

describe('resolveDynamic', () => {
  it('resolves a literal dynamic import', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/page.ts': '',
    });
    const result = resolveDynamic({ kind: 'literal', source: './page' }, '/proj/src/index.ts', {
      projectRoot: '/proj',
      fs,
    });
    expect(result).toEqual({ kind: 'resolved', target: '/proj/src/page.ts' });
  });

  it('marks a template-with-prefix as unresolvable', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/locales/en.json': '',
      '/proj/src/locales/de.json': '',
    });
    const result = resolveDynamic(
      { kind: 'template', prefix: './locales/', suffix: '.json' },
      '/proj/src/index.ts',
      { projectRoot: '/proj', fs },
    );
    expect(result.kind).toBe('unresolvable');
    if (result.kind === 'unresolvable') {
      expect(result.source).toBe('./locales/*.json');
    }
  });

  it('marks an unresolved literal dynamic import as unresolvable', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/index.ts': '' });
    const result = resolveDynamic({ kind: 'literal', source: './missing' }, '/proj/src/index.ts', {
      projectRoot: '/proj',
      fs,
    });
    expect(result).toEqual({ kind: 'unresolvable', source: './missing' });
  });
});

// ---------------------------------------------------------------------------
// resolveReactNative
// ---------------------------------------------------------------------------

describe('resolveReactNative', () => {
  it('prefers .ios.tsx over .tsx when both exist', () => {
    const fs = createMemoryFsAdapter({
      '/app/src/index.tsx': '',
      '/app/src/Button.tsx': '',
      '/app/src/Button.ios.tsx': '',
    });
    expect(resolveReactNative('./Button', '/app/src/index.tsx', undefined, fs)).toBe(
      '/app/src/Button.ios.tsx',
    );
  });

  it('falls back to vanilla extension when no platform variant exists', () => {
    const fs = createMemoryFsAdapter({
      '/app/src/index.tsx': '',
      '/app/src/Button.tsx': '',
    });
    expect(resolveReactNative('./Button', '/app/src/index.tsx', undefined, fs)).toBe(
      '/app/src/Button.tsx',
    );
  });

  it('honors a custom platform list (web first)', () => {
    const fs = createMemoryFsAdapter({
      '/app/src/index.tsx': '',
      '/app/src/Button.web.tsx': '',
      '/app/src/Button.ios.tsx': '',
    });
    expect(resolveReactNative('./Button', '/app/src/index.tsx', ['web', 'ios'], fs)).toBe(
      '/app/src/Button.web.tsx',
    );
  });

  it('returns null when no candidate exists', () => {
    const fs = createMemoryFsAdapter({ '/app/src/index.tsx': '' });
    expect(resolveReactNative('./Missing', '/app/src/index.tsx', undefined, fs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fallbacks
// ---------------------------------------------------------------------------

describe('fallbacks', () => {
  it('maps a dist/foo.js path back to src/foo.ts', () => {
    const fs = createMemoryFsAdapter({
      '/proj/packages/ui/src/utils.ts': '',
    });
    expect(tryOutputToSourceFallback('/proj/packages/ui/dist/utils.js', fs)).toBe(
      '/proj/packages/ui/src/utils.ts',
    );
  });

  it('maps nested dist/esm/foo.mjs back to src/foo.ts', () => {
    const fs = createMemoryFsAdapter({
      '/proj/packages/ui/src/utils.ts': '',
    });
    expect(tryOutputToSourceFallback('/proj/packages/ui/dist/esm/utils.mjs', fs)).toBe(
      '/proj/packages/ui/src/utils.ts',
    );
  });

  it('returns null when no source file exists', () => {
    const fs = createMemoryFsAdapter({});
    expect(tryOutputToSourceFallback('/proj/packages/ui/dist/utils.js', fs)).toBeNull();
  });

  it('wide index probe accepts .cjs and .json', () => {
    const fs = createMemoryFsAdapter({
      '/proj/lib/index.cjs': '',
    });
    expect(tryWideIndexProbe('/proj/lib', fs)).toBe('/proj/lib/index.cjs');
  });
});
