/**
 * hidden-dirs.test.ts — T044-test (half 1) for the hidden-directory
 * allowlist (T045 / `hidden-dirs.ts`).
 *
 * Pinned by ADR-006: only five entries — `.storybook`, `.vitepress`,
 * `.well-known`, `.changeset`, `.github`. Anything else starting with `.`
 * is skipped.
 */
import { describe, expect, it } from 'vitest';
import { HIDDEN_DIR_ALLOWLIST, isHiddenDirAllowed, shouldTraverseHidden } from '../hidden-dirs.js';

describe('HIDDEN_DIR_ALLOWLIST — exact contents', () => {
  it('contains exactly the 5 ADR-006 entries in deterministic order', () => {
    expect([...HIDDEN_DIR_ALLOWLIST]).toEqual([
      '.storybook',
      '.vitepress',
      '.well-known',
      '.changeset',
      '.github',
    ]);
  });

  it('is frozen — push() throws TypeError in strict mode', () => {
    expect(() => {
      // The array is frozen; mutating must throw rather than silently no-op.
      (HIDDEN_DIR_ALLOWLIST as string[]).push('.foo');
    }).toThrow(TypeError);
  });
});

describe('isHiddenDirAllowed — allowlist membership', () => {
  it('returns true for each of the 5 allowlisted names', () => {
    for (const name of ['.storybook', '.vitepress', '.well-known', '.changeset', '.github']) {
      expect(isHiddenDirAllowed(name)).toBe(true);
    }
  });

  it('returns false for .git (intentionally excluded)', () => {
    expect(isHiddenDirAllowed('.git')).toBe(false);
  });

  it('returns false for .vscode and .idea', () => {
    expect(isHiddenDirAllowed('.vscode')).toBe(false);
    expect(isHiddenDirAllowed('.idea')).toBe(false);
  });

  it('is case-sensitive — .GITHUB is NOT allowed (only .github)', () => {
    expect(isHiddenDirAllowed('.GITHUB')).toBe(false);
    expect(isHiddenDirAllowed('.GitHub')).toBe(false);
    expect(isHiddenDirAllowed('.Storybook')).toBe(false);
  });

  it('returns false for other dot-directories (.next, .turbo, .cache, .nuxt)', () => {
    expect(isHiddenDirAllowed('.next')).toBe(false);
    expect(isHiddenDirAllowed('.turbo')).toBe(false);
    expect(isHiddenDirAllowed('.cache')).toBe(false);
    expect(isHiddenDirAllowed('.nuxt')).toBe(false);
  });
});

describe('shouldTraverseHidden — non-hidden vs hidden', () => {
  it('returns true for any non-hidden directory name', () => {
    expect(shouldTraverseHidden('src')).toBe(true);
    expect(shouldTraverseHidden('packages')).toBe(true);
    expect(shouldTraverseHidden('node_modules')).toBe(true);
  });

  it('returns true for hidden allowlist entries', () => {
    expect(shouldTraverseHidden('.github')).toBe(true);
    expect(shouldTraverseHidden('.storybook')).toBe(true);
  });

  it('returns false for hidden directories not on the allowlist', () => {
    expect(shouldTraverseHidden('.git')).toBe(false);
    expect(shouldTraverseHidden('.next')).toBe(false);
    expect(shouldTraverseHidden('.vscode')).toBe(false);
  });
});
