/**
 * find-dupes.test.ts — Phase 3h.5 — `findDupes()` behavior.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDupes } from '../find-dupes.js';

function defaultConfig(): FugaziConfig {
  return {
    rules: {},
    include: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    exclude: ['node_modules', 'dist', 'build', 'coverage'],
    production: false,
    strict: false,
    experimentalTsPlugins: false,
  };
}

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fugazi-node-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  tempDirs = [];
});

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
});

describe('findDupes()', () => {
  it('returns empty cloneFamilies on an empty project', async () => {
    const root = await makeTempDir();
    const result = await findDupes({ projectRoot: root, config: defaultConfig() });
    expect(result.cloneFamilies).toEqual([]);
    expect(result.metrics).toBeTypeOf('object');
  });

  it('runs happy-path over a small project', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
    const result = await findDupes({ projectRoot: root, config: defaultConfig() });
    expect(Array.isArray(result.cloneFamilies)).toBe(true);
    for (const issue of result.cloneFamilies) {
      expect(issue.kind).toBe('code-duplication');
    }
  });
});
