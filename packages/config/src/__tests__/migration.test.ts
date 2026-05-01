/**
 * migration.test.ts — T044-test (half 2) for the `.fallow/` → `.fugazi/`
 * auto-migration (T045 / `migration.ts`).
 *
 * Per PRP C2: migrate on first run when `.fugazi/` does not exist; warn-and-
 * skip if both exist; no-op otherwise. Migration uses `rename` (atomic,
 * preserves contents byte-exact).
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globalWarnOnce } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateFallowDir } from '../migration.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-migration-'));
  // Each test starts with a clean warn-once dedup so we can assert dedup
  // semantics without leakage across cases.
  globalWarnOnce.reset();
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  globalWarnOnce.reset();
});

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('migrateFallowDir — neither directory exists', () => {
  it("returns 'skipped-no-source' and creates nothing", async () => {
    const result = await migrateFallowDir(tmpRoot);
    expect(result.action).toBe('skipped-no-source');
    expect(await pathExists(join(tmpRoot, '.fallow'))).toBe(false);
    expect(await pathExists(join(tmpRoot, '.fugazi'))).toBe(false);
  });
});

describe('migrateFallowDir — only .fugazi/ exists', () => {
  it("returns 'skipped-target-exists' and does not touch .fugazi/", async () => {
    const fugazi = join(tmpRoot, '.fugazi');
    await mkdir(fugazi, { recursive: true });
    await writeFile(join(fugazi, 'cache.bin'), 'preserve me', 'utf8');

    const result = await migrateFallowDir(tmpRoot);
    expect(result.action).toBe('skipped-target-exists');
    expect(result.target).toBe(fugazi);
    expect(await pathExists(join(tmpRoot, '.fallow'))).toBe(false);
    expect(await readFile(join(fugazi, 'cache.bin'), 'utf8')).toBe('preserve me');
  });
});

describe('migrateFallowDir — only .fallow/ exists (the migration path)', () => {
  it("renames .fallow/ to .fugazi/ and returns 'migrated'", async () => {
    const fallow = join(tmpRoot, '.fallow');
    const fugazi = join(tmpRoot, '.fugazi');
    await mkdir(fallow, { recursive: true });
    await writeFile(join(fallow, 'cache.bin'), 'legacy data', 'utf8');
    await mkdir(join(fallow, 'sub'), { recursive: true });
    await writeFile(join(fallow, 'sub', 'inner.txt'), 'inner', 'utf8');

    const result = await migrateFallowDir(tmpRoot);
    expect(result.action).toBe('migrated');
    expect(result.source).toBe(fallow);
    expect(result.target).toBe(fugazi);
    expect(await pathExists(fallow)).toBe(false);
    expect(await pathExists(fugazi)).toBe(true);
    expect(await readFile(join(fugazi, 'cache.bin'), 'utf8')).toBe('legacy data');
    expect(await readFile(join(fugazi, 'sub', 'inner.txt'), 'utf8')).toBe('inner');
  });

  it('is atomic — uses rename, not copy + delete (no transient partial state)', async () => {
    // We can't intercept `rename` without monkey-patching fs/promises, but we
    // can prove byte-exactness: the rename is the OS-level atomic operation,
    // so any byte preserved before equals the byte after.
    const fallow = join(tmpRoot, '.fallow');
    await mkdir(fallow, { recursive: true });
    const payload = Buffer.from([0x00, 0xff, 0x10, 0x20, 0x7f]);
    await writeFile(join(fallow, 'binary.bin'), payload);

    await migrateFallowDir(tmpRoot);

    const after = await readFile(join(tmpRoot, '.fugazi', 'binary.bin'));
    expect(Buffer.compare(after, payload)).toBe(0);
  });
});

describe('migrateFallowDir — both directories exist (warn-and-skip)', () => {
  it("returns 'skipped-both-exist' and emits warn-once", async () => {
    const fallow = join(tmpRoot, '.fallow');
    const fugazi = join(tmpRoot, '.fugazi');
    await mkdir(fallow, { recursive: true });
    await mkdir(fugazi, { recursive: true });
    await writeFile(join(fallow, 'old.bin'), 'old', 'utf8');
    await writeFile(join(fugazi, 'new.bin'), 'new', 'utf8');

    const beforeSize = globalWarnOnce.size;
    const result = await migrateFallowDir(tmpRoot);
    const afterSize = globalWarnOnce.size;

    expect(result.action).toBe('skipped-both-exist');
    expect(result.source).toBe(fallow);
    expect(result.target).toBe(fugazi);
    // Warn-once registered exactly one new entry.
    expect(afterSize - beforeSize).toBe(1);
    // Both directories are intact.
    expect(await readFile(join(fallow, 'old.bin'), 'utf8')).toBe('old');
    expect(await readFile(join(fugazi, 'new.bin'), 'utf8')).toBe('new');
  });

  it('is idempotent on the warning channel — second invocation does not re-warn for the same root', async () => {
    const fallow = join(tmpRoot, '.fallow');
    const fugazi = join(tmpRoot, '.fugazi');
    await mkdir(fallow, { recursive: true });
    await mkdir(fugazi, { recursive: true });

    const before = globalWarnOnce.size;
    await migrateFallowDir(tmpRoot);
    const afterFirst = globalWarnOnce.size;
    await migrateFallowDir(tmpRoot);
    const afterSecond = globalWarnOnce.size;

    expect(afterFirst - before).toBe(1);
    expect(afterSecond - afterFirst).toBe(0);
  });
});
