/**
 * changed-since.test.ts — Phase 3d.6 (T106-test + T107-test) acceptance suite
 * for `getGitToplevel`, `__resetGitToplevelCacheForTest`, and
 * `getChangedSince`.
 *
 * The whole suite mocks `node:child_process` so we never shell out to a real
 * git binary. The mock implementation reads from a per-test "scenario" object
 * that maps `(command, args, cwd)` tuples to canned `{ stdout, stderr,
 * exitCode }` payloads. This keeps tests platform-independent (no real repo
 * required) and lets us assert call counts to verify the process-singleton
 * cache contract.
 *
 * Regression #190 (Turborepo subdirectory): `getGitToplevel` resolves the
 * canonical repo root even when CWD is N levels deep inside the repo, and
 * the second call from a sibling subdirectory hits the cache via the
 * canonical-toplevel cross-link.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FugaziGraphError, canonicalize } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// -----------------------------------------------------------------------------
// child_process mock
// -----------------------------------------------------------------------------

interface CannedResponse {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}

interface CallRecord {
  readonly mode: 'exec' | 'execFile';
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

const calls: CallRecord[] = [];
let scenario: (rec: CallRecord) => CannedResponse = () => ({ stdout: '', stderr: '' });

function setScenario(handler: (rec: CallRecord) => CannedResponse): void {
  scenario = handler;
}

vi.mock('node:child_process', () => {
  // promisify(exec) reads `exec[promisify.custom]` if present; we expose that
  // so `promisify(exec)` returns a function that resolves to { stdout, stderr }.
  // Same for execFile. Vitest's mock replaces the module record, so the
  // `promisify(exec)` inside git-toplevel.ts/changed-since.ts modules sees
  // these versions when invoked.
  const { promisify } = require('node:util') as typeof import('node:util');

  const exec = (
    command: string,
    options: { cwd?: string } | undefined,
    callback?: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    // Support both (cmd, options, cb) and (cmd, cb) signatures.
    let cb: ((err: Error | null, stdout: string, stderr: string) => void) | undefined;
    let opts: { cwd?: string } | undefined;
    if (typeof options === 'function') {
      cb = options as unknown as (err: Error | null, stdout: string, stderr: string) => void;
      opts = undefined;
    } else {
      opts = options;
      cb = callback;
    }
    const rec: CallRecord = { mode: 'exec', command, args: [], cwd: opts?.cwd };
    calls.push(rec);
    const response = scenario(rec);
    const stdout = response.stdout ?? '';
    const stderr = response.stderr ?? '';
    const exitCode = response.exitCode ?? 0;
    queueMicrotask(() => {
      if (exitCode === 0) {
        cb?.(null, stdout, stderr);
      } else {
        const err = new Error(`Command failed: ${command}`) as Error & {
          stdout: string;
          stderr: string;
          code: number;
        };
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = exitCode;
        cb?.(err, stdout, stderr);
      }
    });
  };

  // Add the [util.promisify.custom] override so `promisify(exec)` returns
  // a Promise resolving to { stdout, stderr } (matching Node's real shape).
  Object.defineProperty(exec, promisify.custom, {
    value: (command: string, opts?: { cwd?: string }) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const rec: CallRecord = { mode: 'exec', command, args: [], cwd: opts?.cwd };
        calls.push(rec);
        const response = scenario(rec);
        const stdout = response.stdout ?? '';
        const stderr = response.stderr ?? '';
        const exitCode = response.exitCode ?? 0;
        queueMicrotask(() => {
          if (exitCode === 0) {
            resolve({ stdout, stderr });
          } else {
            const err = new Error(`Command failed: ${command}`) as Error & {
              stdout: string;
              stderr: string;
              code: number;
            };
            err.stdout = stdout;
            err.stderr = stderr;
            err.code = exitCode;
            reject(err);
          }
        });
      }),
  });

  const execFile = (
    command: string,
    args: readonly string[],
    options: { cwd?: string } | undefined,
    callback?: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    let cb: ((err: Error | null, stdout: string, stderr: string) => void) | undefined;
    let opts: { cwd?: string } | undefined;
    if (typeof options === 'function') {
      cb = options as unknown as (err: Error | null, stdout: string, stderr: string) => void;
      opts = undefined;
    } else {
      opts = options;
      cb = callback;
    }
    const rec: CallRecord = { mode: 'execFile', command, args: [...args], cwd: opts?.cwd };
    calls.push(rec);
    const response = scenario(rec);
    const stdout = response.stdout ?? '';
    const stderr = response.stderr ?? '';
    const exitCode = response.exitCode ?? 0;
    queueMicrotask(() => {
      if (exitCode === 0) {
        cb?.(null, stdout, stderr);
      } else {
        const err = new Error(`Command failed: ${command}`) as Error & {
          stdout: string;
          stderr: string;
          code: number;
        };
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = exitCode;
        cb?.(err, stdout, stderr);
      }
    });
  };

  Object.defineProperty(execFile, promisify.custom, {
    value: (command: string, args: readonly string[], opts?: { cwd?: string }) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const rec: CallRecord = { mode: 'execFile', command, args: [...args], cwd: opts?.cwd };
        calls.push(rec);
        const response = scenario(rec);
        const stdout = response.stdout ?? '';
        const stderr = response.stderr ?? '';
        const exitCode = response.exitCode ?? 0;
        queueMicrotask(() => {
          if (exitCode === 0) {
            resolve({ stdout, stderr });
          } else {
            const err = new Error(`Command failed: ${command}`) as Error & {
              stdout: string;
              stderr: string;
              code: number;
            };
            err.stdout = stdout;
            err.stderr = stderr;
            err.code = exitCode;
            reject(err);
          }
        });
      }),
  });

  return { exec, execFile };
});

// -----------------------------------------------------------------------------
// Imports under test (after the mock is registered above)
// -----------------------------------------------------------------------------

import { getChangedSince } from '../changed-since.js';
import { __resetGitToplevelCacheForTest, getGitToplevel } from '../git-toplevel.js';

// -----------------------------------------------------------------------------
// Test scaffolding
// -----------------------------------------------------------------------------

let workDir: string;
let canonicalRepo: string;

beforeEach(async () => {
  __resetGitToplevelCacheForTest();
  calls.length = 0;
  scenario = () => ({ stdout: '', stderr: '' });
  workDir = await mkdtemp(join(tmpdir(), 'fugazi-changed-since-'));
  canonicalRepo = await canonicalize(workDir);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function countToplevelCalls(): number {
  return calls.filter((c) => c.mode === 'exec' && c.command === 'git rev-parse --show-toplevel')
    .length;
}

// -----------------------------------------------------------------------------
// getGitToplevel — process-singleton cache
// -----------------------------------------------------------------------------

describe('getGitToplevel — cache & determinism', () => {
  test('process-singleton: concurrent calls share the same Promise (only one spawn)', async () => {
    setScenario(() => ({ stdout: `${canonicalRepo}\n` }));
    const [a, b] = await Promise.all([getGitToplevel(workDir), getGitToplevel(workDir)]);
    expect(a).toBe(canonicalRepo);
    expect(b).toBe(canonicalRepo);
    expect(countToplevelCalls()).toBe(1);
  });

  test('cache hit on second call from same cwd (no re-spawn)', async () => {
    setScenario(() => ({ stdout: `${canonicalRepo}\n` }));
    await getGitToplevel(workDir);
    await getGitToplevel(workDir);
    expect(countToplevelCalls()).toBe(1);
  });

  test('cache key normalization: subdirectory of same repo hits same cache entry as parent', async () => {
    // First call from a deep subdir spawns git and resolves to canonicalRepo.
    // Second call from the canonical repo path hits the cross-link cache.
    setScenario(() => ({ stdout: `${canonicalRepo}\n` }));
    const subdir = join(workDir, 'apps', 'web');
    const first = await getGitToplevel(subdir);
    expect(first).toBe(canonicalRepo);
    const second = await getGitToplevel(canonicalRepo);
    expect(second).toBe(canonicalRepo);
    // Only the first call should have spawned git; the second hit the
    // canonical-toplevel cross-link.
    expect(countToplevelCalls()).toBe(1);
  });

  test('errors wrap as FugaziGraphError({ code: GIT_TOPLEVEL_FAILED }) with verbatim message', async () => {
    setScenario(() => ({
      stdout: '',
      stderr: 'fatal: not a git repository\n',
      exitCode: 128,
    }));
    await expect(getGitToplevel(workDir)).rejects.toBeInstanceOf(FugaziGraphError);
    try {
      await getGitToplevel(workDir);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FugaziGraphError);
      const fe = err as FugaziGraphError;
      expect(fe.code).toBe('GIT_TOPLEVEL_FAILED');
      expect(fe.message).toBe(
        `git rev-parse --show-toplevel failed for ${workDir}: fatal: not a git repository`,
      );
    }
  });

  test('verbatim error uses <no stderr> when stderr is empty', async () => {
    setScenario(() => ({ stdout: '', stderr: '   \n', exitCode: 1 }));
    try {
      await getGitToplevel(workDir);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FugaziGraphError);
      const fe = err as FugaziGraphError;
      expect(fe.message).toBe(`git rev-parse --show-toplevel failed for ${workDir}: <no stderr>`);
    }
  });

  test('cache invalidation on different repo root (each repo has its own toplevel)', async () => {
    const otherDir = await mkdtemp(join(tmpdir(), 'fugazi-other-repo-'));
    const canonicalOther = await canonicalize(otherDir);
    try {
      setScenario((rec) => {
        if (rec.cwd === workDir) return { stdout: `${canonicalRepo}\n` };
        if (rec.cwd === otherDir) return { stdout: `${canonicalOther}\n` };
        return { stdout: '', stderr: 'unexpected cwd', exitCode: 1 };
      });
      const a = await getGitToplevel(workDir);
      const b = await getGitToplevel(otherDir);
      expect(a).toBe(canonicalRepo);
      expect(b).toBe(canonicalOther);
      expect(a).not.toBe(b);
      expect(countToplevelCalls()).toBe(2);
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  test('__resetGitToplevelCacheForTest clears state between tests', async () => {
    setScenario(() => ({ stdout: `${canonicalRepo}\n` }));
    await getGitToplevel(workDir);
    expect(countToplevelCalls()).toBe(1);
    __resetGitToplevelCacheForTest();
    await getGitToplevel(workDir);
    expect(countToplevelCalls()).toBe(2);
  });

  test('regression #190: Turborepo subdirectory N levels deep resolves canonical repo root', async () => {
    // Even if the caller invokes from `apps/web/src/components`, the resolved
    // toplevel is the canonical repo root — `git rev-parse --show-toplevel`
    // is what makes that work.
    setScenario(() => ({ stdout: `${canonicalRepo}\n` }));
    const deep = join(workDir, 'apps', 'web', 'src', 'components');
    const out = await getGitToplevel(deep);
    expect(out).toBe(canonicalRepo);
  });
});

// -----------------------------------------------------------------------------
// getChangedSince
// -----------------------------------------------------------------------------

describe('getChangedSince', () => {
  test('single ref returns canonical paths sorted lex', async () => {
    // Set up a real file structure so canonicalize() succeeds.
    await writeFile(join(workDir, 'b.ts'), 'export {};\n');
    await writeFile(join(workDir, 'a.ts'), 'export {};\n');

    setScenario((rec) => {
      if (rec.command === 'git rev-parse --show-toplevel') {
        return { stdout: `${canonicalRepo}\n` };
      }
      if (rec.mode === 'execFile' && rec.command === 'git') {
        // committed-since-ref: return both files
        if (rec.args[0] === 'diff' && rec.args[1] === '--name-only' && rec.args[2] === 'HEAD~1') {
          return { stdout: 'b.ts\na.ts\n' };
        }
        // unstaged + staged: empty
        return { stdout: '' };
      }
      return { stdout: '' };
    });

    const out = await getChangedSince({ cwd: workDir, ref: 'HEAD~1' });
    expect(out).toHaveLength(2);
    // Sorted lex (bare < / >, NOT localeCompare)
    expect(out[0]).toBe(`${canonicalRepo}/a.ts`);
    expect(out[1]).toBe(`${canonicalRepo}/b.ts`);
  });

  test('includeUncommitted = false skips HEAD and --cached diffs', async () => {
    await writeFile(join(workDir, 'committed.ts'), 'export {};\n');
    await writeFile(join(workDir, 'unstaged.ts'), 'export {};\n');

    setScenario((rec) => {
      if (rec.command === 'git rev-parse --show-toplevel') {
        return { stdout: `${canonicalRepo}\n` };
      }
      if (rec.mode === 'execFile' && rec.command === 'git') {
        if (rec.args[2] === 'main') return { stdout: 'committed.ts\n' };
        if (rec.args[2] === 'HEAD') return { stdout: 'unstaged.ts\n' };
        if (rec.args[2] === '--cached') return { stdout: 'unstaged.ts\n' };
        return { stdout: '' };
      }
      return { stdout: '' };
    });

    const out = await getChangedSince({ cwd: workDir, ref: 'main', includeUncommitted: false });
    expect(out).toEqual([`${canonicalRepo}/committed.ts`]);
    // Verify only ONE diff invocation happened (no HEAD or --cached calls)
    const diffCalls = calls.filter((c) => c.mode === 'execFile' && c.command === 'git');
    expect(diffCalls).toHaveLength(1);
    expect(diffCalls[0]?.args).toEqual(['diff', '--name-only', 'main']);
  });

  test('empty diff returns an empty array (no throw)', async () => {
    setScenario((rec) => {
      if (rec.command === 'git rev-parse --show-toplevel') {
        return { stdout: `${canonicalRepo}\n` };
      }
      return { stdout: '' };
    });
    const out = await getChangedSince({ cwd: workDir, ref: 'HEAD~1' });
    expect(out).toEqual([]);
  });

  test('errors wrap as FugaziGraphError({ code: CHANGED_SINCE_FAILED }) with verbatim message', async () => {
    setScenario((rec) => {
      if (rec.command === 'git rev-parse --show-toplevel') {
        return { stdout: `${canonicalRepo}\n` };
      }
      if (rec.mode === 'execFile' && rec.command === 'git') {
        return {
          stdout: '',
          stderr: "fatal: bad revision 'nope'\n",
          exitCode: 128,
        };
      }
      return { stdout: '' };
    });
    try {
      await getChangedSince({ cwd: workDir, ref: 'nope' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FugaziGraphError);
      const fe = err as FugaziGraphError;
      expect(fe.code).toBe('CHANGED_SINCE_FAILED');
      expect(fe.message).toBe(
        `changed-since query failed for ref 'nope' in ${canonicalRepo}: fatal: bad revision 'nope'`,
      );
    }
  });

  test('regression #190: subdirectory invocation joins paths against canonical toplevel', async () => {
    // Workspace is at <repo>/frontend; `git diff` emits repo-root-relative
    // paths like `frontend/src/new.ts`. The function must join those against
    // the canonical toplevel, NOT the cwd.
    const frontendSrc = join(workDir, 'frontend', 'src');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(frontendSrc, { recursive: true });
    await writeFile(join(frontendSrc, 'new.ts'), 'export {};\n');

    setScenario((rec) => {
      if (rec.command === 'git rev-parse --show-toplevel') {
        // Even though cwd is the frontend subdir, rev-parse returns the repo root
        return { stdout: `${canonicalRepo}\n` };
      }
      if (rec.mode === 'execFile' && rec.command === 'git') {
        if (rec.args[2] === 'main') return { stdout: 'frontend/src/new.ts\n' };
        return { stdout: '' };
      }
      return { stdout: '' };
    });

    const out = await getChangedSince({
      cwd: join(workDir, 'frontend'),
      ref: 'main',
      includeUncommitted: false,
    });
    const expected = await canonicalize(join(canonicalRepo, 'frontend/src/new.ts'));
    expect(out).toEqual([expected]);
    // The bogus double-frontend path must NOT be in the set.
    expect(out).not.toContain(`${join(workDir, 'frontend')}/frontend/src/new.ts`);
  });

  test('deduplicates files reported by multiple diffs (committed + unstaged + staged)', async () => {
    await writeFile(join(workDir, 'shared.ts'), 'export {};\n');
    setScenario((rec) => {
      if (rec.command === 'git rev-parse --show-toplevel') {
        return { stdout: `${canonicalRepo}\n` };
      }
      if (rec.mode === 'execFile' && rec.command === 'git') {
        // Same file in all three diff outputs — should appear once in result.
        return { stdout: 'shared.ts\n' };
      }
      return { stdout: '' };
    });
    const out = await getChangedSince({ cwd: workDir, ref: 'HEAD~1' });
    expect(out).toEqual([`${canonicalRepo}/shared.ts`]);
  });

  test('skips files that no longer exist on disk (canonicalize fails)', async () => {
    // Only a.ts is written; deleted.ts does not exist on disk.
    await writeFile(join(workDir, 'a.ts'), 'export {};\n');
    setScenario((rec) => {
      if (rec.command === 'git rev-parse --show-toplevel') {
        return { stdout: `${canonicalRepo}\n` };
      }
      if (rec.mode === 'execFile' && rec.command === 'git') {
        if (rec.args[2] === 'HEAD~1') return { stdout: 'a.ts\ndeleted.ts\n' };
        return { stdout: '' };
      }
      return { stdout: '' };
    });
    const out = await getChangedSince({ cwd: workDir, ref: 'HEAD~1' });
    expect(out).toEqual([`${canonicalRepo}/a.ts`]);
  });
});
