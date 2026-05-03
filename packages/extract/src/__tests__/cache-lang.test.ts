/**
 * cache-lang.test.ts — Phase 4a T310 — language-discriminated cache keys.
 *
 * Asserts that the optional `lang` field on `CacheKeyParts` namespaces the
 * derived hash key so that TS and Py inventories cannot collide on identical
 * filenames.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ParseCacheStore, createStore, deriveKey, read, write } from '../cache/store.js';
import type { ScanResult } from '../parsers/scan.js';

let tmpRoot: string;
let store: ParseCacheStore;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-cache-lang-'));
  store = createStore(tmpRoot);
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('cache key — language namespace (T310)', () => {
  it('same filename, different lang → different keys', () => {
    const ts = deriveKey({
      filePath: '/repo/foo',
      parserId: 'swc-wasm',
      parserVersion: '1.15.32',
      lang: 'ts',
    });
    const py = deriveKey({
      filePath: '/repo/foo',
      parserId: 'tree-sitter-python',
      parserVersion: '0.24.0',
      lang: 'py',
    });
    expect(ts).not.toBe(py);
  });

  it('absent lang defaults to ts (backwards-compat for pre-T310 callers)', () => {
    const noLang = deriveKey({
      filePath: '/repo/foo.ts',
      parserId: 'swc-wasm',
      parserVersion: '1.15.32',
    });
    const explicitTs = deriveKey({
      filePath: '/repo/foo.ts',
      parserId: 'swc-wasm',
      parserVersion: '1.15.32',
      lang: 'ts',
    });
    expect(noLang).toBe(explicitTs);
  });

  it('cache hit/miss correctness: TS write does NOT collide with Py read on same path', async () => {
    const filePath = '/repo/shared/name';
    const tsKey = deriveKey({
      filePath,
      parserId: 'swc-wasm',
      parserVersion: '1.15.32',
      lang: 'ts',
    });
    const pyKey = deriveKey({
      filePath,
      parserId: 'tree-sitter-python',
      parserVersion: '0.24.0',
      lang: 'py',
    });

    const tsValue: ScanResult = { ast: null, errors: [] };
    await write<ScanResult>(store, tsKey, tsValue);

    // Reading the Python key on a never-written cache returns null — the TS
    // entry under a co-located filename does NOT satisfy the Python read.
    const pyHit = await read<ScanResult>(store, pyKey);
    expect(pyHit).toBeNull();

    // The TS entry is still readable.
    const tsHit = await read<ScanResult>(store, tsKey);
    expect(tsHit).not.toBeNull();
  });

  it('changing only `lang` from ts to py changes the hex key', () => {
    const baseTs = deriveKey({
      filePath: '/x',
      parserId: 'p',
      parserVersion: 'v',
      lang: 'ts',
    });
    const basePy = deriveKey({
      filePath: '/x',
      parserId: 'p',
      parserVersion: 'v',
      lang: 'py',
    });
    expect(baseTs).toMatch(/^[0-9a-f]{64}$/);
    expect(basePy).toMatch(/^[0-9a-f]{64}$/);
    expect(baseTs).not.toBe(basePy);
  });
});
