/**
 * migration.ts — T045 (half 2): one-shot legacy-directory migration.
 *
 * Per PRP C2: when a project still carries a legacy `.fallow/` cache and has
 * not yet adopted `.fugazi/`, rename the directory in-place. Atomic (single
 * `rename` syscall, byte-exact). If both exist, warn-once and leave both
 * untouched — manual cleanup is requested. If neither exists, no-op.
 *
 * The migration is idempotent: a second run on the same project tree is a
 * no-op (`.fallow/` is already gone, only `.fugazi/` remains).
 */
import { rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { globalWarnOnce } from '@fugazi/types';

/**
 * The shape of {@link migrateFallowDir}'s return value. The `action` field is
 * a discriminated literal; downstream callers can branch on it without
 * checking the optional `source` / `target` paths.
 */
export interface MigrationResult {
  readonly action:
    | 'migrated'
    | 'skipped-both-exist'
    | 'skipped-no-source'
    | 'skipped-target-exists';
  readonly source?: string;
  readonly target?: string;
}

/**
 * Inspect `<projectRoot>/.fallow/` and `<projectRoot>/.fugazi/` and migrate
 * if and only if the source exists and the target does not.
 *
 * @param projectRoot Absolute or relative path to the project root.
 */
export async function migrateFallowDir(projectRoot: string): Promise<MigrationResult> {
  const fallowPath = join(projectRoot, '.fallow');
  const fugaziPath = join(projectRoot, '.fugazi');

  const fallowExists = await pathExists(fallowPath);
  const fugaziExists = await pathExists(fugaziPath);

  if (!fallowExists && !fugaziExists) {
    return { action: 'skipped-no-source' };
  }
  if (!fallowExists && fugaziExists) {
    return { action: 'skipped-target-exists', target: fugaziPath };
  }
  if (fallowExists && fugaziExists) {
    // Per C2: warn-and-skip if both are present. Use the per-process
    // warn-once channel keyed by projectRoot so repeated invocations on the
    // same tree do not spam the user.
    globalWarnOnce.warn(
      `Both .fallow/ and .fugazi/ exist at ${projectRoot}; skipping migration. Manual cleanup of .fallow/ recommended.`,
      projectRoot,
    );
    return { action: 'skipped-both-exist', source: fallowPath, target: fugaziPath };
  }

  // Only the source exists — perform the rename.
  await rename(fallowPath, fugaziPath);
  return { action: 'migrated', source: fallowPath, target: fugaziPath };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
