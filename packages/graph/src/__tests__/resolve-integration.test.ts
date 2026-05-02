/**
 * resolve-integration.test.ts — T089 / T090 end-to-end suite for the unified
 * dispatcher. Each fixture exercises the cascading dispatch path the
 * resolver takes when the first strategy misses.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../resolve/fs-adapter.js';
import { type ResolverContext, __clearTsconfigCacheForTest, resolve } from '../resolve/index.js';
import { __clearPackageJsonCacheForTest } from '../resolve/node-modules.js';

afterEach(() => {
  __clearPackageJsonCacheForTest();
  __clearTsconfigCacheForTest();
});

describe('resolve (dispatcher)', () => {
  it('relative -> resolved', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/foo.ts': '',
    });
    const ctx: ResolverContext = { projectRoot: '/proj', fs };
    expect(resolve('./foo', '/proj/src/index.ts', ctx)).toEqual({
      kind: 'resolved',
      target: '/proj/src/foo.ts',
    });
  });

  it('alias -> resolved', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/components/Button.tsx': '',
    });
    const ctx: ResolverContext = { projectRoot: '/proj', fs };
    expect(resolve('@/components/Button', '/proj/src/index.ts', ctx)).toEqual({
      kind: 'resolved',
      target: '/proj/components/Button.tsx',
    });
  });

  it('tsconfig paths (pre-parsed) -> resolved', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/lib/util.ts': '',
    });
    const ctx: ResolverContext = {
      projectRoot: '/proj',
      tsconfigPaths: {
        baseUrl: '/proj',
        paths: new Map([['~lib/*', ['./src/lib/*']]]),
      },
      fs,
    };
    expect(resolve('~lib/util', '/proj/src/index.ts', ctx)).toEqual({
      kind: 'resolved',
      target: '/proj/src/lib/util.ts',
    });
  });

  it('node_modules -> resolved', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lodash/package.json': '{"main":"./index.js"}',
      '/proj/node_modules/lodash/index.js': '',
    });
    const ctx: ResolverContext = { projectRoot: '/proj', fs };
    expect(resolve('lodash', '/proj/src/index.ts', ctx)).toEqual({
      kind: 'resolved',
      target: '/proj/node_modules/lodash/index.js',
    });
  });

  it('unknown bare specifier -> external', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/index.ts': '' });
    const ctx: ResolverContext = { projectRoot: '/proj', fs };
    expect(resolve('react', '/proj/src/index.ts', ctx)).toEqual({
      kind: 'external',
      source: 'react',
    });
  });

  it('relative miss -> unresolved (not external)', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/index.ts': '' });
    const ctx: ResolverContext = { projectRoot: '/proj', fs };
    expect(resolve('./missing', '/proj/src/index.ts', ctx)).toEqual({
      kind: 'unresolved',
      source: './missing',
    });
  });

  it('alias miss -> unresolved (not external)', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/index.ts': '' });
    const ctx: ResolverContext = { projectRoot: '/proj', fs };
    expect(resolve('@/missing', '/proj/src/index.ts', ctx)).toEqual({
      kind: 'unresolved',
      source: '@/missing',
    });
  });

  it('determinism: same input always yields the same output', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/foo.ts': '',
      '/proj/node_modules/lodash/package.json': '{"main":"./index.js"}',
      '/proj/node_modules/lodash/index.js': '',
    });
    const ctx: ResolverContext = { projectRoot: '/proj', fs };
    const a = JSON.stringify(resolve('./foo', '/proj/src/index.ts', ctx));
    const b = JSON.stringify(resolve('./foo', '/proj/src/index.ts', ctx));
    const c = JSON.stringify(resolve('lodash', '/proj/src/index.ts', ctx));
    const d = JSON.stringify(resolve('lodash', '/proj/src/index.ts', ctx));
    expect(a).toBe(b);
    expect(c).toBe(d);
  });

  it('cascade: tsconfig miss falls through to node_modules', () => {
    // Specifier `lodash/merge` doesn't match a `paths` pattern, so the
    // dispatcher falls through to node_modules where it succeeds via the
    // deep-import path.
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/node_modules/lodash/package.json': '{"main":"./index.js"}',
      '/proj/node_modules/lodash/index.js': '',
      '/proj/node_modules/lodash/merge.js': '',
    });
    const ctx: ResolverContext = {
      projectRoot: '/proj',
      tsconfigPaths: {
        baseUrl: '/proj',
        paths: new Map([['@/*', ['./src/*']]]),
      },
      fs,
    };
    expect(resolve('lodash/merge', '/proj/src/index.ts', ctx)).toEqual({
      kind: 'resolved',
      target: '/proj/node_modules/lodash/merge.js',
    });
  });
});
