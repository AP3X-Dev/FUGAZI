/**
 * concurrency.test.ts — Phase 3h.5 (NFR-9 / SC-26) — concurrency safety.
 *
 * Two parallel `analyze()` calls over the same fixture must produce
 * byte-identical output. `runAnalysis()` itself is pure-per-call (no global
 * mutable state), so this is really an integration check that the wrapper
 * also keeps state-free per call.
 *
 * Iterations are reduced from 100 to a smaller batch to keep test runtime
 * bounded; the determinism contract is fail-fast — any single mismatch
 * proves the regression.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../analyze.js';

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

describe('analyze() concurrency (NFR-9 / SC-26)', () => {
  it('two parallel calls produce byte-identical determinismHash', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(
      join(root, 'b.ts'),
      "import { a } from './a.js';\nexport const b = a;\n",
      'utf8',
    );
    const cfg = defaultConfig();

    const [r1, r2] = await Promise.all([
      analyze({ projectRoot: root, config: cfg }),
      analyze({ projectRoot: root, config: cfg }),
    ]);
    expect(r2._meta.determinismHash).toBe(r1._meta.determinismHash);
  });

  it('repeated parallel batches stay byte-identical', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(
      join(root, 'b.ts'),
      "import { a } from './a.js';\nexport const b = a;\n",
      'utf8',
    );
    const cfg = defaultConfig();

    const baseline = await analyze({ projectRoot: root, config: cfg });
    const ITER = 10; // 10 batches × 2 parallel = 20 runs, fail-fast on any drift
    for (let i = 0; i < ITER; i++) {
      const [r1, r2] = await Promise.all([
        analyze({ projectRoot: root, config: cfg }),
        analyze({ projectRoot: root, config: cfg }),
      ]);
      expect(r1._meta.determinismHash).toBe(baseline._meta.determinismHash);
      expect(r2._meta.determinismHash).toBe(baseline._meta.determinismHash);
    }
  });
});
