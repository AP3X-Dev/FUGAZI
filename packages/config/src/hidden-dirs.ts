/**
 * hidden-dirs.ts — T045 (half 1): hardcoded hidden-directory allowlist.
 *
 * The walker maintains a fixed list of five hidden directories that may be
 * descended into. Anything else starting with `.` is skipped. The list is
 * frozen so accidental mutation throws in strict mode (per ADR-006 and the
 * §7.6 trap-6 directive: "Fugazi: hardcode same list; reject improvements
 * that broaden or narrow it without an ADR").
 *
 * Adding or removing entries requires an ADR update. The exhaustiveness test
 * in `__tests__/hidden-dirs.test.ts` pins the canonical list.
 */

/**
 * Canonical 5-entry hidden-directory allowlist (ADR-006).
 *
 *   - `.storybook`   — Storybook config (preview, manager).
 *   - `.vitepress`   — VitePress site config and theme.
 *   - `.well-known`  — RFC 5785 server metadata; sometimes contains TS source.
 *   - `.changeset`   — Changesets release-management config.
 *   - `.github`      — GitHub Actions workflows (TypeScript supported).
 */
export const HIDDEN_DIR_ALLOWLIST: readonly string[] = Object.freeze([
  '.storybook',
  '.vitepress',
  '.well-known',
  '.changeset',
  '.github',
]);

/**
 * Returns `true` iff `name` is one of the five allowlisted hidden dirs.
 * Case-sensitive: `.GITHUB` is NOT a match for `.github`.
 */
export function isHiddenDirAllowed(name: string): boolean {
  return HIDDEN_DIR_ALLOWLIST.includes(name);
}

/**
 * Filesystem-walk gate: returns `true` if the walker should descend into a
 * directory whose basename is `name`. Non-hidden names always pass; hidden
 * names pass only when on the allowlist.
 */
export function shouldTraverseHidden(name: string): boolean {
  if (!name.startsWith('.')) return true;
  return isHiddenDirAllowed(name);
}
