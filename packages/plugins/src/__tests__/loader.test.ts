/**
 * loader.test.ts — bundled-plugin loader contract tests.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadBundledPlugins,
  loadBundledPluginsVerbose,
  loadExternalPlugin,
  tryValidatePlugin,
  validatePlugin,
} from '../loader.js';

describe('validatePlugin', () => {
  it('returns a frozen plugin on valid input', () => {
    const p = validatePlugin({ name: 'frozen', enablers: ['x'] });
    expect(Object.isFrozen(p)).toBe(true);
    expect(p.name).toBe('frozen');
  });
  it('throws on invalid input', () => {
    expect(() => validatePlugin({ enablers: ['x'] })).toThrow();
  });
});

describe('tryValidatePlugin', () => {
  it('returns ok=true on valid input', () => {
    const r = tryValidatePlugin({ name: 'ok' });
    expect(r.ok).toBe(true);
    expect(r.plugin?.name).toBe('ok');
    expect(r.error).toBeUndefined();
  });
  it('returns ok=false with ZodError on invalid input', () => {
    const r = tryValidatePlugin({ enablers: ['x'] });
    expect(r.ok).toBe(false);
    expect(r.plugin).toBeUndefined();
    expect(r.error).toBeDefined();
  });
});

describe('loadBundledPlugins', () => {
  it('returns a non-empty frozen list', () => {
    const plugins = loadBundledPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    expect(Object.isFrozen(plugins)).toBe(true);
  });
  it('returns 121 bundled plugins', () => {
    const plugins = loadBundledPlugins();
    expect(plugins).toHaveLength(121);
  });
  it('every plugin is frozen', () => {
    const plugins = loadBundledPlugins();
    for (const p of plugins) {
      expect(Object.isFrozen(p)).toBe(true);
    }
  });
  it('returns plugins sorted alphabetically by name', () => {
    const plugins = loadBundledPlugins();
    const names = plugins.map((p) => p.name);
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toEqual(sorted);
  });
  it('every plugin has a non-empty name', () => {
    const plugins = loadBundledPlugins();
    for (const p of plugins) {
      expect(p.name.length).toBeGreaterThan(0);
    }
  });
  it('plugin names are unique', () => {
    const plugins = loadBundledPlugins();
    const names = new Set(plugins.map((p) => p.name));
    expect(names.size).toBe(plugins.length);
  });
  it('two consecutive loads return the same list', () => {
    const a = loadBundledPlugins();
    const b = loadBundledPlugins();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]?.name).toBe(b[i]?.name);
    }
  });
});

describe('loadBundledPluginsVerbose', () => {
  it('produces zero validation errors for the bundled corpus', () => {
    const result = loadBundledPluginsVerbose();
    expect(result.errors).toHaveLength(0);
    expect(result.plugins).toHaveLength(121);
  });
});

describe('loadExternalPlugin', () => {
  it('loads a valid JSON plugin from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fugazi-plugins-test-'));
    try {
      const path = join(dir, 'custom.json');
      writeFileSync(path, JSON.stringify({ name: 'custom', enablers: ['my-fw'] }));
      const plugin = loadExternalPlugin(path);
      expect(plugin.name).toBe('custom');
      expect(plugin.enablers).toEqual(['my-fw']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('throws on missing file with verbatim message prefix', () => {
    expect(() => loadExternalPlugin('/no/such/path/foo.json')).toThrow(
      /^plugins: cannot read external plugin at /,
    );
  });
  it('throws on invalid JSON with verbatim message prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fugazi-plugins-test-'));
    try {
      const path = join(dir, 'bad.json');
      writeFileSync(path, '{not-json');
      expect(() => loadExternalPlugin(path)).toThrow(
        /^plugins: invalid JSON in external plugin at /,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('throws on schema-failed plugin with verbatim message prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fugazi-plugins-test-'));
    try {
      const path = join(dir, 'invalid.json');
      writeFileSync(path, JSON.stringify({ enablers: ['x'] }));
      expect(() => loadExternalPlugin(path)).toThrow(/^plugins: schema validation failed for /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bundled plugin shapes', () => {
  it('every plugin has a defaulted entryPointRole', () => {
    const plugins = loadBundledPlugins();
    for (const p of plugins) {
      expect(['runtime', 'test', 'support']).toContain(p.entryPointRole);
    }
  });
  it('every list field is an array', () => {
    const plugins = loadBundledPlugins();
    for (const p of plugins) {
      expect(Array.isArray(p.enablers)).toBe(true);
      expect(Array.isArray(p.entryPoints)).toBe(true);
      expect(Array.isArray(p.configPatterns)).toBe(true);
      expect(Array.isArray(p.alwaysUsed)).toBe(true);
      expect(Array.isArray(p.toolingDependencies)).toBe(true);
      expect(Array.isArray(p.usedExports)).toBe(true);
      expect(Array.isArray(p.usedClassMembers)).toBe(true);
    }
  });
});
