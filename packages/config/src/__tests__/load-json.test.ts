import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FugaziConfigError } from '@fugazi/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadJsonConfig } from '../loaders/json.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', '..', 'test', 'fixtures', 'load-json');

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-load-json-'));
});

afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('loadJsonConfig — well-formed input', () => {
  it('parses a plain JSON file', async () => {
    const result = (await loadJsonConfig(resolve(FIXTURES, 'well-formed.json'))) as Record<
      string,
      unknown
    >;
    expect(result.rules).toEqual({ 'unused-files': 'error' });
    expect(result.production).toBe(false);
  });

  it('parses JSONC with line and block comments', async () => {
    const result = (await loadJsonConfig(resolve(FIXTURES, 'with-comments.jsonc'))) as Record<
      string,
      unknown
    >;
    expect(result.rules).toEqual({ 'unused-files': 'warn' });
  });

  it('parses JSONC with trailing commas', async () => {
    const result = (await loadJsonConfig(
      resolve(FIXTURES, 'with-trailing-commas.jsonc'),
    )) as Record<string, unknown>;
    expect(result.include).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    expect(result.exclude).toEqual(['dist']);
  });
});

describe('loadJsonConfig — UTF-8 BOM (E3)', () => {
  it('strips a UTF-8 BOM and round-trips identically to the same content without BOM', async () => {
    const body = '{"rules": {"unused-files": "error"}}';
    const withBom = join(tmpRoot, 'with-bom.json');
    const withoutBom = join(tmpRoot, 'without-bom.json');
    await writeFile(withBom, `﻿${body}`, 'utf8');
    await writeFile(withoutBom, body, 'utf8');

    const a = await loadJsonConfig(withBom);
    const b = await loadJsonConfig(withoutBom);
    expect(a).toEqual(b);
    expect((a as Record<string, unknown>).rules).toEqual({ 'unused-files': 'error' });
  });
});

describe('loadJsonConfig — error paths (verbatim strings per E5)', () => {
  it('throws FugaziConfigError with verbatim message when the file is missing', async () => {
    const missing = join(tmpRoot, 'does-not-exist.json');
    await expect(loadJsonConfig(missing)).rejects.toThrow(FugaziConfigError);
    await expect(loadJsonConfig(missing)).rejects.toMatchObject({
      code: 'CONFIG_FILE_NOT_FOUND',
      message: `Config file not found: ${missing}`,
    });
  });

  it('throws FugaziConfigError with verbatim message when JSON is malformed', async () => {
    const path = resolve(FIXTURES, 'malformed.json');
    let caught: unknown;
    try {
      await loadJsonConfig(path);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const err = caught as FugaziConfigError;
    expect(err.code).toBe('CONFIG_PARSE_FAILED');
    expect(err.message.startsWith(`Failed to parse JSON config at ${path}: `)).toBe(true);
  });
});
