import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { canonicalize } from '../canonicalize.js';
import { FugaziError } from '../errors/index.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'fugazi-canonicalize-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('canonicalize — common semantics', () => {
  test('returns a resolved path for an existing file', async () => {
    const file = join(workDir, 'a.ts');
    await writeFile(file, '');
    const out = await canonicalize(file);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  test('throws FugaziError with code FS_PATH_NOT_FOUND when path does not exist', async () => {
    const missing = join(workDir, 'does-not-exist.ts');
    await expect(canonicalize(missing)).rejects.toBeInstanceOf(FugaziError);
    try {
      await canonicalize(missing);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FugaziError);
      const fe = err as FugaziError;
      expect(fe.code).toBe('FS_PATH_NOT_FOUND');
      // Verbatim message contract per E5
      expect(fe.message).toBe(`Path not found: ${missing}`);
      expect(fe.cause).toBeInstanceOf(Error);
    }
  });

  test('strips trailing slash from a directory path', async () => {
    const dir = join(workDir, 'sub');
    await mkdir(dir);
    const withSlash = `${dir}${process.platform === 'win32' ? '\\' : '/'}`;
    const out = await canonicalize(withSlash);
    // No trailing forward-slash (we always normalize to forward slashes on win)
    expect(out.endsWith('/')).toBe(false);
    // Also no trailing backslash
    expect(out.endsWith('\\')).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('canonicalize — POSIX-only', () => {
  test('resolves a symlink to its target', async () => {
    const target = join(workDir, 'target.ts');
    const link = join(workDir, 'link.ts');
    await writeFile(target, '');
    await symlink(target, link);
    const out = await canonicalize(link);
    const targetCanonical = await canonicalize(target);
    expect(out).toBe(targetCanonical);
  });

  test('uses forward slashes on POSIX', async () => {
    const file = join(workDir, 'a.ts');
    await writeFile(file, '');
    const out = await canonicalize(file);
    expect(out).not.toContain('\\');
  });

  test('does not contain Windows verbatim prefix on POSIX', async () => {
    const file = join(workDir, 'a.ts');
    await writeFile(file, '');
    const out = await canonicalize(file);
    expect(out.startsWith('\\\\?\\')).toBe(false);
  });
});

describe.skipIf(process.platform !== 'win32')('canonicalize — Windows-only', () => {
  test('strips the \\\\?\\ verbatim prefix when present', async () => {
    const file = join(workDir, 'a.ts');
    await writeFile(file, '');
    const out = await canonicalize(file);
    expect(out.startsWith('\\\\?\\')).toBe(false);
    expect(out.startsWith('//?/')).toBe(false);
  });

  test('converts backslashes to forward slashes', async () => {
    const file = join(workDir, 'a.ts');
    await writeFile(file, '');
    const out = await canonicalize(file);
    expect(out).not.toContain('\\');
    expect(out).toContain('/');
  });

  test('uppercases the drive letter', async () => {
    const file = join(workDir, 'a.ts');
    await writeFile(file, '');
    const out = await canonicalize(file);
    // Output starts with an uppercase ASCII letter followed by ':'
    expect(/^[A-Z]:/.test(out)).toBe(true);
  });

  test('drive-letter input case is normalized to uppercase', async () => {
    const file = join(workDir, 'a.ts');
    await writeFile(file, '');
    // Lowercase the drive letter in the input path
    const lowered =
      file.length >= 2 && file[1] === ':'
        ? `${(file[0] ?? '').toLowerCase()}${file.slice(1)}`
        : file;
    const out = await canonicalize(lowered);
    expect(/^[A-Z]:/.test(out)).toBe(true);
  });
});
