/**
 * changed-since.ts — Phase 3d.6 (T107) — async changed-since query.
 *
 * `getChangedSince({ cwd, ref, includeUncommitted })` returns the canonical
 * absolute paths of files changed between `ref` and HEAD. When
 * `includeUncommitted` is true (the default), the result also includes
 * unstaged worktree changes and staged-but-uncommitted changes.
 *
 * Mechanism:
 *   1. Resolve the git toplevel via `getGitToplevel(cwd)`. Per IMP-PERF-05
 *      this spawns `git rev-parse --show-toplevel` only once per root.
 *   2. `git diff --name-only <ref>` for committed-since-ref changes.
 *   3. If `includeUncommitted !== false`:
 *        - `git diff --name-only HEAD` (unstaged worktree changes)
 *        - `git diff --name-only --cached` (staged but uncommitted)
 *   4. Each relative path is joined against the toplevel and canonicalized.
 *      The union of all sets is sorted lex (bare `<`/`>`, NOT localeCompare —
 *      NFR-1 determinism) and de-duplicated via a Set before sort-on-emit.
 *
 * Errors wrap as `FugaziGraphError({ code: 'CHANGED_SINCE_FAILED' })` with
 * the verbatim message:
 *   `changed-since query failed for ref '<ref>' in <toplevel>: <stderr>`
 * where `<stderr>` is the trimmed git stderr or `<no stderr>` when empty.
 *
 * Files that no longer exist on disk (deleted in the worktree but tracked by
 * git) cannot be canonicalized — they are skipped. This keeps the contract
 * simple: every returned path is a real, on-disk, canonical file.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FugaziGraphError, canonicalize } from '@fugazi/types';
import { getGitToplevel } from './git-toplevel.js';

const execFileP = promisify(execFile);

export interface ChangedSinceOptions {
  /**
   * The working directory where the `git diff` invocations are spawned.
   * It does not need to be the repository toplevel — `getGitToplevel` walks
   * up to find the canonical root. The toplevel is what relative paths from
   * `git diff --name-only` are joined against.
   */
  readonly cwd: string;
  /**
   * The base ref (commit-ish) to diff against HEAD. Caller-supplied; this
   * function does NOT validate it (the CLI / LSP boundary should call
   * `validateGitRef` before passing untrusted input).
   */
  readonly ref: string;
  /**
   * When true (the default), the result also includes unstaged AND staged
   * changes, matching the original Fallow contract for `--changed-since`.
   * When false, only committed changes between `ref` and HEAD are returned.
   */
  readonly includeUncommitted?: boolean;
}

/**
 * Run `git diff --name-only <args...>` in `toplevel` and return the trimmed
 * stdout lines. Throws `FugaziGraphError({ code: 'CHANGED_SINCE_FAILED' })`
 * with the verbatim error format on git failure.
 */
async function runDiff(toplevel: string, ref: string, args: readonly string[]): Promise<string[]> {
  let stdout: string;
  try {
    const result = await execFileP('git', ['diff', '--name-only', ...args], { cwd: toplevel });
    stdout = String(result.stdout ?? '');
  } catch (cause) {
    const stderrRaw =
      cause && typeof cause === 'object' && 'stderr' in cause
        ? String((cause as { stderr?: unknown }).stderr ?? '')
        : '';
    const trimmed = stderrRaw.trim();
    const stderrText = trimmed.length === 0 ? '<no stderr>' : trimmed;
    throw new FugaziGraphError({
      code: 'CHANGED_SINCE_FAILED',
      message: `changed-since query failed for ref '${ref}' in ${toplevel}: ${stderrText}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  // Split on \n (works for both LF and CRLF since git only ever inserts LF
  // between paths on its own; \r if present is trimmed below).
  const out: string[] = [];
  for (const line of stdout.split('\n')) {
    const value = line.replace(/\r$/, '');
    if (value.length > 0) out.push(value);
  }
  return out;
}

/**
 * Returns the canonical absolute paths of files changed between `ref` and
 * HEAD. When `includeUncommitted` is true (default), also includes unstaged
 * AND staged worktree changes. Result is lex-sorted and de-duplicated.
 *
 * Determinism: sort uses bare `<`/`>` (NOT localeCompare) per NFR-1.
 */
export async function getChangedSince(opts: ChangedSinceOptions): Promise<readonly string[]> {
  const includeUncommitted = opts.includeUncommitted !== false;
  const toplevel = await getGitToplevel(opts.cwd);

  const seen = new Set<string>();
  const collect = async (args: readonly string[]): Promise<void> => {
    const lines = await runDiff(toplevel, opts.ref, args);
    for (const rel of lines) {
      const absolute = `${toplevel}/${rel}`;
      let canonical: string;
      try {
        canonical = await canonicalize(absolute);
      } catch {
        // Path may have been deleted in the worktree but still appears in
        // `git diff --name-only`. Skipping keeps the contract: every
        // returned path is a real, on-disk, canonical file.
        continue;
      }
      seen.add(canonical);
    }
  };

  // Committed changes between ref..HEAD
  await collect([opts.ref]);
  if (includeUncommitted) {
    // Unstaged worktree changes
    await collect(['HEAD']);
    // Staged but not yet committed
    await collect(['--cached']);
  }

  // NFR-1: bare-comparison lex sort, NOT localeCompare.
  const out = [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.freeze(out);
}
