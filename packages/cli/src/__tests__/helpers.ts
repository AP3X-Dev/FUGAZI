/**
 * __tests__/helpers.ts — shared test utilities.
 *
 * `makeContext()` builds a minimal `BaseContext` whose stdout/stderr buffer
 * writes to in-memory strings, so tests can assert on output without spawning
 * a child process. `withTempProject` runs a callback against a freshly minted
 * temp project root, cleaning up afterwards.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { BaseContext } from 'clipanion';

export interface TestContext extends BaseContext {
  getStdout(): string;
  getStderr(): string;
}

/** Build a minimal `BaseContext` whose streams accumulate to in-memory strings. */
export function makeContext(env: Record<string, string | undefined> = {}): TestContext {
  let outBuf = '';
  let errBuf = '';
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      outBuf += chunk.toString();
      callback();
    },
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      errBuf += chunk.toString();
      callback();
    },
  });
  const stdin = new Readable({ read() {} });
  return {
    env: { ...env },
    stdin,
    stdout,
    stderr,
    colorDepth: 1,
    getStdout: () => outBuf,
    getStderr: () => errBuf,
  };
}

/** Run a callback against a fresh temp project root. Cleans up on completion. */
export async function withTempProject<T>(
  files: Readonly<Record<string, string>>,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'fugazi-cli-test-'));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const full = join(root, relative);
      const parts = full.split(/[\\/]/);
      const dir = parts.slice(0, -1).join('/');
      await mkdir(dir, { recursive: true });
      await writeFile(full, content, 'utf8');
    }
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
