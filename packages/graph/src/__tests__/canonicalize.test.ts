/**
 * canonicalize.test.ts — Phase 3d.6 (T104-test) — sanity coverage for the
 * `canonicalize` re-export from @fugazi/graph.
 *
 * The deep platform-specific behavior (verbatim-prefix stripping, drive-letter
 * uppercasing, symlink resolution, FS_PATH_NOT_FOUND error wrapping) is owned
 * by the test suite in @fugazi/types — see
 * `packages/types/src/__tests__/canonicalize.test.ts`. The tests here only
 * confirm the re-export wiring is intact and the function meets its
 * post-condition contract from the consumer's viewpoint.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { canonicalize } from '../canonicalize.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'fugazi-graph-canon-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('canonicalize re-export — @fugazi/graph surface', () => {
  test('canonicalize is reachable from @fugazi/graph', () => {
    expect(typeof canonicalize).toBe('function');
  });

  test('returns a non-empty string for an existing absolute path', async () => {
    const file = join(workDir, 'a.ts');
    await writeFile(file, '');
    const out = await canonicalize(file);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  test('idempotent: canonicalize(canonicalize(x)) === canonicalize(x)', async () => {
    const dir = join(workDir, 'sub');
    await mkdir(dir);
    const once = await canonicalize(dir);
    const twice = await canonicalize(once);
    expect(twice).toBe(once);
  });

  test('output uses POSIX-style forward slashes (no backslashes)', async () => {
    const file = join(workDir, 'b.ts');
    await writeFile(file, '');
    const out = await canonicalize(file);
    expect(out).not.toContain('\\');
  });

  test('strips trailing slash from a directory path', async () => {
    const dir = join(workDir, 'trail');
    await mkdir(dir);
    const withSlash = `${dir}${process.platform === 'win32' ? '\\' : '/'}`;
    const out = await canonicalize(withSlash);
    expect(out.endsWith('/')).toBe(false);
    expect(out.endsWith('\\')).toBe(false);
  });
});
