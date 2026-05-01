import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FugaziConfigError } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../define-config.js';
import { loadTsConfig } from '../loaders/ts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', '..', 'test', 'fixtures', 'load-ts');

describe('loadTsConfig — default export', () => {
  it('returns the default-exported object', async () => {
    const result = (await loadTsConfig(resolve(FIXTURES, 'default-export.ts'))) as Record<
      string,
      unknown
    >;
    expect(result.rules).toEqual({
      'unused-files': 'error',
      'unused-exports': 'warn',
    });
    expect(result.production).toBe(false);
  });
});

describe('loadTsConfig — defineConfig() helper', () => {
  it('returns the value passed through defineConfig', async () => {
    const result = (await loadTsConfig(resolve(FIXTURES, 'define-config.ts'))) as Record<
      string,
      unknown
    >;
    expect(result.rules).toEqual({ 'unused-files': 'warn' });
    expect(result.include).toEqual(['src/**/*.ts']);
    expect(result.production).toBe(true);
  });

  it('defineConfig is an identity function (compile-time inference helper)', () => {
    const input = {
      rules: { 'unused-files': 'error' as const },
      include: ['**/*.ts'],
      exclude: ['node_modules'],
      production: false,
      strict: false,
      experimentalTsPlugins: false,
    };
    expect(defineConfig(input)).toBe(input);
  });
});

describe('loadTsConfig — error paths (verbatim strings per E5)', () => {
  it('throws FugaziConfigError for malformed TS source', async () => {
    const path = resolve(FIXTURES, 'malformed.ts');
    let caught: unknown;
    try {
      await loadTsConfig(path);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const err = caught as FugaziConfigError;
    expect(err.code).toBe('CONFIG_PARSE_FAILED');
    expect(err.message).toBe(`Failed to load TS config at ${path}`);
  });
});
