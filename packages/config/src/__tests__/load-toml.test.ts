import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FugaziConfigError } from '@fugazi/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTomlConfig } from '../loaders/toml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', '..', 'test', 'fixtures', 'load-toml');

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-load-toml-'));
});

afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('loadTomlConfig — well-formed input', () => {
  it('parses a basic TOML file with a top-level table', async () => {
    const result = (await loadTomlConfig(resolve(FIXTURES, 'well-formed.toml'))) as Record<
      string,
      unknown
    >;
    expect(result.production).toBe(false);
    expect(result.rules).toEqual({
      'unused-files': 'error',
      'unused-exports': 'warn',
    });
  });

  it('parses arrays', async () => {
    const result = (await loadTomlConfig(resolve(FIXTURES, 'with-arrays.toml'))) as Record<
      string,
      unknown
    >;
    expect(result.include).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    expect(result.exclude).toEqual(['node_modules', 'dist']);
    expect(result.frameworks).toEqual(['react', 'vitest']);
  });

  it('parses nested tables', async () => {
    const result = (await loadTomlConfig(resolve(FIXTURES, 'nested-tables.toml'))) as Record<
      string,
      unknown
    >;
    expect(result.production).toBe(true);
    expect(result.rules).toEqual({
      'unused-files': 'error',
      complexity: { threshold: 20 },
    });
  });

  it('parses an array of tables', async () => {
    const result = (await loadTomlConfig(resolve(FIXTURES, 'array-of-tables.toml'))) as Record<
      string,
      unknown
    >;
    expect(result.plugins).toEqual([{ name: 'react' }, { name: 'next' }]);
  });

  it('parses a minimal one-line file', async () => {
    const result = (await loadTomlConfig(resolve(FIXTURES, 'minimal.toml'))) as Record<
      string,
      unknown
    >;
    expect(result.production).toBe(false);
  });
});

describe('loadTomlConfig — UTF-8 BOM (E3)', () => {
  it('strips a UTF-8 BOM and round-trips identically', async () => {
    const body = 'production = true\n';
    const withBom = join(tmpRoot, 'with-bom.toml');
    const withoutBom = join(tmpRoot, 'without-bom.toml');
    await writeFile(withBom, `﻿${body}`, 'utf8');
    await writeFile(withoutBom, body, 'utf8');

    const a = await loadTomlConfig(withBom);
    const b = await loadTomlConfig(withoutBom);
    expect(a).toEqual(b);
    expect((a as Record<string, unknown>).production).toBe(true);
  });
});

describe('loadTomlConfig — determinism', () => {
  it('parses the same file twice into deeply-equal objects', async () => {
    const a = await loadTomlConfig(resolve(FIXTURES, 'nested-tables.toml'));
    const b = await loadTomlConfig(resolve(FIXTURES, 'nested-tables.toml'));
    const sortedJson = (val: unknown): string => JSON.stringify(val, Object.keys(val ?? {}).sort());
    expect(sortedJson(a)).toBe(sortedJson(b));
  });
});

describe('loadTomlConfig — error paths (verbatim strings per E5)', () => {
  it('throws FugaziConfigError when the file is missing', async () => {
    const missing = join(tmpRoot, 'does-not-exist.toml');
    await expect(loadTomlConfig(missing)).rejects.toThrow(FugaziConfigError);
    await expect(loadTomlConfig(missing)).rejects.toMatchObject({
      code: 'CONFIG_FILE_NOT_FOUND',
      message: `Config file not found: ${missing}`,
    });
  });

  it('throws FugaziConfigError with verbatim message when TOML is malformed', async () => {
    const path = resolve(FIXTURES, 'malformed.toml');
    let caught: unknown;
    try {
      await loadTomlConfig(path);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const err = caught as FugaziConfigError;
    expect(err.code).toBe('CONFIG_PARSE_FAILED');
    expect(err.message).toBe(`Failed to parse TOML config at ${path}`);
  });
});
