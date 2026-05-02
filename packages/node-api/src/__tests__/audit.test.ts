/**
 * audit.test.ts — Phase 3h.5 — `audit()` behavior.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { audit } from '../audit.js';

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

describe('audit()', () => {
  it('emits zero issues on an empty project', async () => {
    const root = await makeTempDir();
    const result = await audit({ projectRoot: root, config: defaultConfig() });
    expect(result.issues).toEqual([]);
    expect(result.inventory.fileCount).toBe(0);
    expect(result.inventory.edgeCount).toBe(0);
  });

  it('reports inventory metadata for a small project', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(
      join(root, 'b.ts'),
      "import { a } from './a.js';\nexport const b = a;\n",
      'utf8',
    );
    const result = await audit({ projectRoot: root, config: defaultConfig() });
    expect(result.issues).toEqual([]);
    expect(result.inventory.fileCount).toBeGreaterThanOrEqual(2);
    expect(result.inventory.edgeCount).toBeGreaterThanOrEqual(0);
  });
});
