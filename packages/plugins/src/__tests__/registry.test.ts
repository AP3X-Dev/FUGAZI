/**
 * registry.test.ts — bundled-plugin registry contract tests.
 */

import { describe, expect, it } from 'vitest';
import {
  __resetRegistryCacheForTest,
  getActivePlugins,
  getBuiltinPlugins,
  getPlugin,
} from '../registry.js';
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

describe('getBuiltinPlugins', () => {
  it('returns 121 bundled plugins', () => {
    expect(getBuiltinPlugins()).toHaveLength(121);
  });
  it('cached on second access', () => {
    const a = getBuiltinPlugins();
    const b = getBuiltinPlugins();
    expect(a).toBe(b);
  });
  it('iteration order is alphabetical-by-name', () => {
    const names = getBuiltinPlugins().map((p) => p.name);
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toEqual(sorted);
  });
});

describe('getPlugin', () => {
  it('looks up by exact name', () => {
    const p = getPlugin('nextjs');
    expect(p?.name).toBe('nextjs');
  });
  it('returns undefined for unknown name', () => {
    expect(getPlugin('not-a-real-plugin')).toBeUndefined();
  });
  it('finds known framework plugins', () => {
    for (const name of ['vite', 'vitest', 'jest', 'eslint', 'prettier', 'tailwind']) {
      expect(getPlugin(name)?.name).toBe(name);
    }
  });
  it('finds runtime-role plugins', () => {
    const p = getPlugin('astro');
    expect(p?.entryPointRole).toBe('runtime');
  });
  it('finds test-role plugins', () => {
    const p = getPlugin('jest');
    expect(p?.entryPointRole).toBe('test');
  });
  it('finds support-role plugins (default)', () => {
    const p = getPlugin('eslint');
    expect(p?.entryPointRole).toBe('support');
  });
});

describe('getActivePlugins', () => {
  it('returns no plugins when no enabler matches', () => {
    const result = getActivePlugins({
      pkg: { dependencies: {} },
      files: [],
    });
    expect(result).toHaveLength(0);
  });
  it('activates nextjs when "next" is in deps', () => {
    const result = getActivePlugins({
      pkg: { dependencies: { next: '^14' } },
      files: [],
    });
    const names = result.map((p) => p.name);
    expect(names).toContain('nextjs');
  });
  it('activates vitest when "vitest" is in deps', () => {
    const result = getActivePlugins({
      pkg: { devDependencies: { vitest: '^2' } },
      files: [],
    });
    expect(result.map((p) => p.name)).toContain('vitest');
  });
  it('activates eslint when in devDeps', () => {
    const result = getActivePlugins({
      pkg: { devDependencies: { eslint: '^9' } },
      files: [],
    });
    expect(result.map((p) => p.name)).toContain('eslint');
  });
  it('activates prettier when in devDeps', () => {
    const result = getActivePlugins({
      pkg: { devDependencies: { prettier: '^3' } },
      files: [],
    });
    expect(result.map((p) => p.name)).toContain('prettier');
  });
  it('activates storybook via prefix enabler', () => {
    const result = getActivePlugins({
      pkg: { devDependencies: { '@storybook/react': '^8' } },
      files: [],
    });
    expect(result.map((p) => p.name)).toContain('storybook');
  });
  it('activates many plugins together', () => {
    const result = getActivePlugins({
      pkg: {
        dependencies: { next: '^14', react: '^18' },
        devDependencies: {
          vitest: '^2',
          eslint: '^9',
          prettier: '^3',
          typescript: '^5',
          tailwindcss: '^3',
        },
      },
      files: [],
    });
    const names = result.map((p) => p.name);
    expect(names).toContain('nextjs');
    expect(names).toContain('vitest');
    expect(names).toContain('eslint');
    expect(names).toContain('prettier');
    expect(names).toContain('typescript');
    expect(names).toContain('tailwind');
  });
  it('respects disable list', () => {
    const result = getActivePlugins(
      {
        pkg: { dependencies: { next: '^14' } },
        files: [],
      },
      { disable: ['nextjs'] },
    );
    expect(result.map((p) => p.name)).not.toContain('nextjs');
  });
  it('appends extras', () => {
    const extra = mkPlugin({ name: 'my-ext', enablers: ['my-pkg'] });
    const result = getActivePlugins(
      {
        pkg: { dependencies: { 'my-pkg': '^1' } },
        files: [],
      },
      { extras: [extra] },
    );
    expect(result.map((p) => p.name)).toContain('my-ext');
  });
  it('iteration is deterministic across two calls', () => {
    const ctx = {
      pkg: { dependencies: { next: '^14', vitest: '^2' } },
      files: [],
    };
    const a = getActivePlugins(ctx).map((p) => p.name);
    const b = getActivePlugins(ctx).map((p) => p.name);
    expect(a).toEqual(b);
  });
});

describe('__resetRegistryCacheForTest', () => {
  it('reloads from disk on next access', () => {
    const a = getBuiltinPlugins();
    __resetRegistryCacheForTest();
    const b = getBuiltinPlugins();
    expect(a).not.toBe(b);
    expect(a.length).toBe(b.length);
  });
});
