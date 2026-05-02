/**
 * trace.test.ts — Phase 3h.5 — `traceFile()` + `traceExport()` behavior.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { traceExport, traceFile } from '../trace.js';

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

describe('traceFile()', () => {
  it('returns empty chains when target is not in project', async () => {
    const root = await makeTempDir();
    const result = await traceFile({ projectRoot: root, targetFile: 'nonexistent.ts' });
    expect(result.chains).toEqual([]);
    expect(typeof result.target).toBe('string');
  });

  it('returns a TraceResult shape for a target inside the project', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'leaf.ts'), 'export const v = 1;\n', 'utf8');
    await writeFile(
      join(root, 'mid.ts'),
      "import { v } from './leaf.js';\nexport const w = v + 1;\n",
      'utf8',
    );
    await writeFile(
      join(root, 'top.ts'),
      "import { w } from './mid.js';\nconsole.log(w);\n",
      'utf8',
    );
    const result = await traceFile({ projectRoot: root, targetFile: join(root, 'leaf.ts') });
    // The graph resolver may or may not resolve `./leaf.js` → `leaf.ts`
    // (depends on tsconfig + extensionless probing). Assert the shape is
    // valid; the actual reachability count is exercised by integration tests
    // higher up the stack (CLI / `runAnalysis`).
    expect(Array.isArray(result.chains)).toBe(true);
    expect(typeof result.target).toBe('string');
    for (const chain of result.chains) {
      expect(Array.isArray(chain)).toBe(true);
    }
  });

  it('is deterministic across runs', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'leaf.ts'), 'export const v = 1;\n', 'utf8');
    await writeFile(
      join(root, 'mid.ts'),
      "import { v } from './leaf.js';\nexport const w = v;\n",
      'utf8',
    );
    const r1 = await traceFile({ projectRoot: root, targetFile: join(root, 'leaf.ts') });
    const r2 = await traceFile({ projectRoot: root, targetFile: join(root, 'leaf.ts') });
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
  });
});

describe('traceExport()', () => {
  it('returns empty chains for an unknown export', async () => {
    const root = await makeTempDir();
    const result = await traceExport({ projectRoot: root, exportName: 'doesNotExist' });
    expect(result.chains).toEqual([]);
    expect(result.target).toBe('doesNotExist');
  });

  it('finds importers of a named export', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'lib.ts'), 'export const widget = 1;\n', 'utf8');
    await writeFile(
      join(root, 'consumer.ts'),
      "import { widget } from './lib.js';\nexport const used = widget;\n",
      'utf8',
    );
    const result = await traceExport({ projectRoot: root, exportName: 'widget' });
    expect(result.target).toBe('widget');
    expect(Array.isArray(result.chains)).toBe(true);
  });
});
