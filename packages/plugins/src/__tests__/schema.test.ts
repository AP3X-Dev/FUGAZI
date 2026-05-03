/**
 * schema.test.ts — Zod runtime-validation contract tests.
 */

import { describe, expect, it } from 'vitest';
import {
  EntryPointRoleSchema,
  PluginDefSchema,
  PluginDetectionSchema,
  ScopedUsedClassMemberSchema,
  UsedClassMemberSchema,
  UsedExportSchema,
} from '../schema.js';

describe('EntryPointRoleSchema', () => {
  it('accepts runtime', () => {
    expect(EntryPointRoleSchema.parse('runtime')).toBe('runtime');
  });
  it('accepts test', () => {
    expect(EntryPointRoleSchema.parse('test')).toBe('test');
  });
  it('accepts support', () => {
    expect(EntryPointRoleSchema.parse('support')).toBe('support');
  });
  it('rejects unknown role', () => {
    expect(() => EntryPointRoleSchema.parse('runtime-only')).toThrow();
  });
  it('rejects null', () => {
    expect(() => EntryPointRoleSchema.parse(null)).toThrow();
  });
});

describe('PluginDetectionSchema', () => {
  it('accepts a dependency rule', () => {
    expect(PluginDetectionSchema.parse({ type: 'dependency', package: 'next' })).toEqual({
      type: 'dependency',
      package: 'next',
    });
  });
  it('accepts a fileExists rule', () => {
    expect(PluginDetectionSchema.parse({ type: 'fileExists', pattern: 'next.config.js' })).toEqual({
      type: 'fileExists',
      pattern: 'next.config.js',
    });
  });
  it('accepts an all combinator', () => {
    const v = PluginDetectionSchema.parse({
      type: 'all',
      conditions: [
        { type: 'dependency', package: 'next' },
        { type: 'fileExists', pattern: 'next.config.js' },
      ],
    });
    expect(v.type).toBe('all');
  });
  it('accepts an any combinator', () => {
    const v = PluginDetectionSchema.parse({
      type: 'any',
      conditions: [
        { type: 'dependency', package: 'react' },
        { type: 'dependency', package: 'preact' },
      ],
    });
    expect(v.type).toBe('any');
  });
  it('accepts nested all/any', () => {
    const v = PluginDetectionSchema.parse({
      type: 'all',
      conditions: [
        {
          type: 'any',
          conditions: [
            { type: 'dependency', package: 'react' },
            { type: 'dependency', package: 'preact' },
          ],
        },
        { type: 'fileExists', pattern: 'src/main.tsx' },
      ],
    });
    expect(v.type).toBe('all');
  });
  it('rejects unknown detection type', () => {
    expect(() => PluginDetectionSchema.parse({ type: 'maybe', package: 'foo' })).toThrow();
  });
  it('rejects dependency rule missing package', () => {
    expect(() => PluginDetectionSchema.parse({ type: 'dependency' })).toThrow();
  });
});

describe('UsedExportSchema', () => {
  it('accepts pattern + exports tuple', () => {
    expect(UsedExportSchema.parse({ pattern: '**/*.ts', exports: ['default', 'loader'] })).toEqual({
      pattern: '**/*.ts',
      exports: ['default', 'loader'],
    });
  });
  it('rejects missing exports field', () => {
    expect(() => UsedExportSchema.parse({ pattern: '**/*.ts' })).toThrow();
  });
  it('rejects non-string export entry', () => {
    expect(() =>
      UsedExportSchema.parse({ pattern: '**/*.ts', exports: [42] as unknown as string[] }),
    ).toThrow();
  });
});

describe('ScopedUsedClassMemberSchema', () => {
  it('accepts extends-only scope', () => {
    expect(
      ScopedUsedClassMemberSchema.parse({ extends: 'Component', members: ['render'] }),
    ).toEqual({ extends: 'Component', members: ['render'] });
  });
  it('accepts implements-only scope', () => {
    expect(
      ScopedUsedClassMemberSchema.parse({
        implements: 'OnInit',
        members: ['ngOnInit'],
      }),
    ).toEqual({ implements: 'OnInit', members: ['ngOnInit'] });
  });
  it('accepts both extends and implements', () => {
    expect(
      ScopedUsedClassMemberSchema.parse({
        extends: 'Component',
        implements: 'OnInit',
        members: ['ngOnInit', 'render'],
      }),
    ).toEqual({
      extends: 'Component',
      implements: 'OnInit',
      members: ['ngOnInit', 'render'],
    });
  });
  it('rejects missing members', () => {
    expect(() => ScopedUsedClassMemberSchema.parse({ extends: 'Component' })).toThrow();
  });
});

describe('UsedClassMemberSchema', () => {
  it('accepts a plain string member', () => {
    expect(UsedClassMemberSchema.parse('agInit')).toBe('agInit');
  });
  it('accepts a scoped object', () => {
    expect(UsedClassMemberSchema.parse({ extends: 'Component', members: ['render'] })).toEqual({
      extends: 'Component',
      members: ['render'],
    });
  });
  it('rejects a non-string non-object', () => {
    expect(() => UsedClassMemberSchema.parse(42)).toThrow();
  });
});

describe('PluginDefSchema', () => {
  it('accepts a minimal plugin (name only)', () => {
    const p = PluginDefSchema.parse({ name: 'minimal' });
    expect(p.name).toBe('minimal');
    expect(p.enablers).toEqual([]);
    expect(p.entryPoints).toEqual([]);
    expect(p.entryPointRole).toBe('support');
    expect(p.configPatterns).toEqual([]);
    expect(p.alwaysUsed).toEqual([]);
    expect(p.toolingDependencies).toEqual([]);
    expect(p.usedExports).toEqual([]);
    expect(p.usedClassMembers).toEqual([]);
  });
  it('accepts a full plugin', () => {
    const p = PluginDefSchema.parse({
      name: 'nextjs',
      enablers: ['next'],
      entryPoints: ['app/**/page.{ts,tsx}'],
      entryPointRole: 'runtime',
      configPatterns: ['next.config.{ts,js}'],
      alwaysUsed: ['next-env.d.ts'],
      toolingDependencies: ['next'],
      usedExports: [{ pattern: 'app/**/page.{ts,tsx}', exports: ['default', 'metadata'] }],
    });
    expect(p.name).toBe('nextjs');
    expect(p.entryPointRole).toBe('runtime');
    expect(p.usedExports).toHaveLength(1);
  });
  it('rejects when name is missing', () => {
    expect(() => PluginDefSchema.parse({ enablers: ['x'] })).toThrow();
  });
  it('rejects when name is non-string', () => {
    expect(() => PluginDefSchema.parse({ name: 42 })).toThrow();
  });
  it('accepts detection without enablers', () => {
    const p = PluginDefSchema.parse({
      name: 'detected',
      detection: { type: 'fileExists', pattern: 'foo.json' },
    });
    expect(p.detection?.type).toBe('fileExists');
  });
  it('preserves detection when set', () => {
    const p = PluginDefSchema.parse({
      name: 'detected',
      detection: { type: 'dependency', package: 'react' },
    });
    expect(p.detection).toEqual({ type: 'dependency', package: 'react' });
  });
  it('round-trips a complex plugin via JSON.stringify', () => {
    const original = {
      name: 'remix',
      enablers: ['@remix-run/node'],
      entryPoints: ['app/routes/**/*.tsx'],
      usedExports: [{ pattern: 'app/routes/**/*.tsx', exports: ['loader', 'action'] }],
    };
    const parsed = PluginDefSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(parsed.name).toBe('remix');
    expect(parsed.usedExports[0]?.exports).toContain('loader');
  });
});
