/**
 * health.test.ts — Phase 3h.5 — `health()` behavior.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { health } from '../health.js';

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

describe('health()', () => {
  it('returns empty issues on an empty project', async () => {
    const root = await makeTempDir();
    const result = await health({ projectRoot: root, config: defaultConfig() });
    expect(result.issues).toEqual([]);
    // v1 limitation: score / refactorTargets are undefined.
    expect(result.score).toBeUndefined();
    expect(result.refactorTargets).toBeUndefined();
  });

  it('runs happy-path; only health-family kinds appear', async () => {
    const root = await makeTempDir();
    await writeFile(
      join(root, 'a.ts'),
      'export function f(x: number): number { return x + 1; }\n',
      'utf8',
    );
    const result = await health({ projectRoot: root, config: defaultConfig() });
    for (const issue of result.issues) {
      expect(['complexity-hotspot', 'cognitive-complexity']).toContain(issue.kind);
    }
  });
});
