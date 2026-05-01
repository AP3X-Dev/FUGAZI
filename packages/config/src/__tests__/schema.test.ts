import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { type FugaziConfig, FugaziConfigSchema, FugaziConfigSchemaPermissive } from '../schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', '..', 'test', 'fixtures', 'schema');

async function readFixture(name: string): Promise<unknown> {
  const text = await readFile(resolve(FIXTURES, name), 'utf8');
  return JSON.parse(text) as unknown;
}

describe('FugaziConfigSchema — valid configs', () => {
  it('accepts an empty object and applies all defaults', async () => {
    const data = await readFixture('minimal.json');
    const parsed = FugaziConfigSchemaPermissive.parse(data);
    expect(parsed.rules).toEqual({});
    expect(parsed.include).toEqual(['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}']);
    expect(parsed.exclude).toEqual(['node_modules', 'dist', 'build', 'coverage']);
    expect(parsed.production).toBe(false);
    expect(parsed.strict).toBe(false);
    expect(parsed.experimentalTsPlugins).toBe(false);
  });

  it('accepts a full config and preserves declared values', async () => {
    const data = await readFixture('full.json');
    const parsed = FugaziConfigSchemaPermissive.parse(data);
    expect(parsed.rules).toEqual({
      'unused-files': 'error',
      'unused-exports': 'warn',
      'unused-types': 'off',
    });
    expect(parsed.include).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    expect(parsed.entrypoints).toEqual(['src/index.ts']);
    expect(parsed.extends).toEqual(['./base.json']);
    expect(parsed.frameworks).toEqual(['react', 'next']);
    expect(parsed.production).toBe(true);
  });

  it('accepts a framework-preset-only config', async () => {
    const data = await readFixture('framework-only.json');
    const parsed = FugaziConfigSchemaPermissive.parse(data);
    expect(parsed.frameworks).toEqual(['vue', 'vitest']);
    expect(parsed.rules).toEqual({});
  });

  it('accepts extends as a single string', async () => {
    const data = await readFixture('extends-string.json');
    const parsed = FugaziConfigSchemaPermissive.parse(data);
    expect(parsed.extends).toBe('./shared.json');
  });

  it('accepts extends as an array of strings', () => {
    const parsed = FugaziConfigSchemaPermissive.parse({
      extends: ['./a.json', './b.json'],
    });
    expect(parsed.extends).toEqual(['./a.json', './b.json']);
  });

  it('round-trips Zod parsed output equals input modulo defaults', () => {
    const input = {
      rules: { 'unused-files': 'error' as const },
      include: ['src/**/*.ts'],
      exclude: ['node_modules'],
      production: true,
      strict: false,
      experimentalTsPlugins: false,
    };
    const parsed = FugaziConfigSchemaPermissive.parse(input);
    expect(parsed.rules).toEqual(input.rules);
    expect(parsed.include).toEqual(input.include);
    expect(parsed.exclude).toEqual(input.exclude);
    expect(parsed.production).toBe(input.production);
    expect(parsed.strict).toBe(input.strict);
    expect(parsed.experimentalTsPlugins).toBe(input.experimentalTsPlugins);
  });
});

describe('FugaziConfigSchema — severity discriminated union', () => {
  it('accepts each severity value', () => {
    for (const sev of ['error', 'warn', 'off'] as const) {
      const parsed = FugaziConfigSchemaPermissive.parse({
        rules: { 'unused-files': sev },
      });
      expect(parsed.rules['unused-files']).toBe(sev);
    }
  });

  it('rejects an unknown severity value', async () => {
    const data = await readFixture('invalid-severity.json');
    expect(() => FugaziConfigSchemaPermissive.parse(data)).toThrow();
  });

  it('rejects an unknown rule id', async () => {
    const data = await readFixture('invalid-rule-id.json');
    expect(() => FugaziConfigSchemaPermissive.parse(data)).toThrow();
  });
});

describe('FugaziConfigSchema — strict vs permissive unknown-key behavior', () => {
  it('permissive schema preserves unknown keys (passthrough)', async () => {
    const data = await readFixture('unknown-key.json');
    const parsed = FugaziConfigSchemaPermissive.parse(data) as Record<string, unknown>;
    expect(parsed.totallyUnknownField).toBe('value');
  });

  it('strict schema rejects unknown keys with an unrecognized_keys issue', async () => {
    const data = await readFixture('unknown-key.json');
    const result = FugaziConfigSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((issue) => issue.code);
      expect(codes).toContain('unrecognized_keys');
    }
  });
});

describe('FugaziConfigSchema — boolean defaults', () => {
  it('production defaults to false', () => {
    const parsed = FugaziConfigSchemaPermissive.parse({});
    expect(parsed.production).toBe(false);
  });

  it('strict defaults to false', () => {
    const parsed = FugaziConfigSchemaPermissive.parse({});
    expect(parsed.strict).toBe(false);
  });

  it('experimentalTsPlugins defaults to false', () => {
    const parsed = FugaziConfigSchemaPermissive.parse({});
    expect(parsed.experimentalTsPlugins).toBe(false);
  });

  it('rejects a non-boolean production value', () => {
    const result = FugaziConfigSchemaPermissive.safeParse({ production: 'yes' });
    expect(result.success).toBe(false);
  });
});

describe('FugaziConfigSchema — type inference', () => {
  it('FugaziConfig type matches inferred schema output', () => {
    expectTypeOf<FugaziConfig>().toMatchTypeOf<{
      readonly rules: Partial<Record<string, 'error' | 'warn' | 'off'>>;
      readonly include: readonly string[];
      readonly exclude: readonly string[];
      readonly production: boolean;
      readonly strict: boolean;
      readonly experimentalTsPlugins: boolean;
    }>();
  });
});
