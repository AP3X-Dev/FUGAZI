/**
 * alias.ts — T083 / T084 — built-in path alias resolver.
 *
 * Implements the small set of conventional path aliases used across the JS
 * ecosystem when no tsconfig configuration is present:
 *
 *   - `~/foo`         -> `<projectRoot>/foo`        (Nuxt, common alias)
 *   - `~~/foo`        -> `<projectRoot>/foo`        (Nuxt root alias)
 *   - `@/foo`         -> `<projectRoot>/foo`        (Vite, Nuxt, very common)
 *   - `@@/foo`        -> `<projectRoot>/foo`        (Nuxt root alias variant)
 *   - `#internal/foo` -> `<projectRoot>/internal/foo` (Node `imports` map convention)
 *
 * Callers may override the prefix table via `ResolverContext.aliases`. The
 * override is a flat map of prefix -> directory (relative to project root or
 * absolute). Longer prefixes win over shorter overlapping ones, so a custom
 * `@@/foo` alias always beats the built-in `@/foo` rule.
 *
 * After substitution the resolved path is probed exactly like a relative
 * import (extension priority, directory index). Returns `null` if no alias
 * matches or if the substituted path does not exist on disk.
 */

import type { FsAdapter } from './fs-adapter.js';
import { joinPosix } from './path-utils.js';
import { RELATIVE_EXTENSIONS } from './relative.js';

/**
 * Default alias table. Entries are checked in length-descending order so the
 * longer `@@/` prefix wins over the shorter `@/` for inputs like `@@/foo`.
 *
 * The empty-string suffix (e.g. `~~` mapping to project root) is intentional
 * — `~~/foo` substitutes to `<root>/foo` directly.
 */
export const DEFAULT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  '~~/': '',
  '@@/': '',
  '~/': '',
  '@/': '',
  '#internal/': 'internal',
});

/**
 * Probe a resolved alias target with the standard extension list. Returns
 * the matched POSIX path or `null`.
 *
 * Mirrors the logic in `resolveRelative` but does NOT walk parent directories
 * (the alias has already produced an absolute path under projectRoot).
 */
function probeAliasTarget(target: string, fs: FsAdapter): string | null {
  // Direct hit when extension is present.
  for (const ext of RELATIVE_EXTENSIONS) {
    if (target.endsWith(ext)) {
      return fs.existsSync(target) && !fs.isDirectorySync(target) ? target : null;
    }
  }
  if (target.endsWith('.json')) {
    return fs.existsSync(target) && !fs.isDirectorySync(target) ? target : null;
  }

  // Extension probing.
  for (const ext of RELATIVE_EXTENSIONS) {
    const probe = `${target}${ext}`;
    if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
  }

  // Directory index.
  if (fs.isDirectorySync(target)) {
    for (const ext of RELATIVE_EXTENSIONS) {
      const probe = joinPosix(target, `index${ext}`);
      if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
    }
  }
  return null;
}

/**
 * Attempt to resolve `specifier` via a built-in or user-supplied alias map.
 *
 * @param specifier   The import specifier (e.g. `@/components/Button`).
 * @param projectRoot Absolute POSIX path to the project root.
 * @param overrides   Optional override table (prefix -> dir). Overrides win
 *                    over `DEFAULT_ALIASES` when keys collide.
 * @param fs          Filesystem adapter.
 * @returns           Resolved POSIX path, or `null` on miss.
 */
export function resolveAlias(
  specifier: string,
  projectRoot: string,
  overrides: Readonly<Record<string, string>> | undefined,
  fs: FsAdapter,
): string | null {
  const table: Record<string, string> = { ...DEFAULT_ALIASES, ...(overrides ?? {}) };

  // Sort keys by length descending so the more specific prefix wins.
  const prefixes = Object.keys(table).sort((a, b) => b.length - a.length);

  for (const prefix of prefixes) {
    if (!specifier.startsWith(prefix)) continue;
    const remainder = specifier.slice(prefix.length);
    const replacement = table[prefix] ?? '';
    const subpath = replacement === '' ? remainder : `${replacement}/${remainder}`;
    const target = joinPosix(projectRoot, subpath);
    const hit = probeAliasTarget(target, fs);
    if (hit !== null) return hit;
    // Important: do NOT fall through to a shorter prefix once a longer one
    // matched. Misspelling `@/comp/Button` (file missing) should report
    // unresolved, not silently fall back to a shorter alias.
    return null;
  }
  return null;
}

/**
 * Return `true` if `specifier` looks like one of the built-in alias prefixes
 * (or a user-supplied override). Used by the unified dispatcher to choose
 * the alias resolver branch without re-running the prefix lookup.
 */
export function matchesAliasPrefix(
  specifier: string,
  overrides: Readonly<Record<string, string>> | undefined,
): boolean {
  const table: Record<string, string> = { ...DEFAULT_ALIASES, ...(overrides ?? {}) };
  for (const prefix of Object.keys(table)) {
    if (specifier.startsWith(prefix)) return true;
  }
  return false;
}
