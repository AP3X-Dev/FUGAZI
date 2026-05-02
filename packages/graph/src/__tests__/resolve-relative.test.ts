/**
 * resolve-relative.test.ts — T081 acceptance suite.
 *
 * Covers each behavioral branch of the relative resolver:
 *   1. simple sibling file  (./foo)
 *   2. parent traversal     (../bar)
 *   3. directory index      (./pkg -> ./pkg/index.ts)
 *   4. explicit extension   (./mod.ts)
 *   5. extension priority   (.ts beats .js)
 *   6. .d.ts loses to .js   (declaration file ranked last)
 *   7. missing target       (returns null, no throw)
 *   8. directory traversal  (lexical only — no escape prevention claimed)
 *   9. case-sensitivity     (paths are looked up byte-equal)
 *  10. non-relative input   (returns null without consulting fs)
 */

import { describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../resolve/fs-adapter.js';
import { resolveRelative } from '../resolve/relative.js';

describe('resolveRelative', () => {
  it('resolves a simple sibling .ts file', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/foo.ts': '',
    });
    expect(resolveRelative('./foo', '/proj/src/index.ts', fs)).toBe('/proj/src/foo.ts');
  });

  it('resolves a parent-relative file', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/a/index.ts': '',
      '/proj/src/bar.ts': '',
    });
    expect(resolveRelative('../bar', '/proj/src/a/index.ts', fs)).toBe('/proj/src/bar.ts');
  });

  it('resolves a directory to its index.ts', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/pkg/index.ts': '',
      '/proj/src/pkg/util.ts': '',
    });
    expect(resolveRelative('./pkg', '/proj/src/index.ts', fs)).toBe('/proj/src/pkg/index.ts');
  });

  it('uses an explicit extension when present', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/mod.ts': '',
    });
    expect(resolveRelative('./mod.ts', '/proj/src/index.ts', fs)).toBe('/proj/src/mod.ts');
  });

  it('prefers .ts over .js when both exist', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/util.ts': '',
      '/proj/src/util.js': '',
    });
    expect(resolveRelative('./util', '/proj/src/index.ts', fs)).toBe('/proj/src/util.ts');
  });

  it('prefers .js over .d.ts when both exist (runtime wins over declaration)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/foo.js': '',
      '/proj/src/foo.d.ts': '',
    });
    expect(resolveRelative('./foo', '/proj/src/index.ts', fs)).toBe('/proj/src/foo.js');
  });

  it('returns null on a missing target without throwing', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
    });
    expect(resolveRelative('./missing', '/proj/src/index.ts', fs)).toBeNull();
  });

  it('handles deep parent traversal lexically (no FS-root escape claim)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/a/b/c/index.ts': '',
      '/proj/shared.ts': '',
    });
    expect(resolveRelative('../../../shared', '/proj/a/b/c/index.ts', fs)).toBe('/proj/shared.ts');
  });

  it('is case-sensitive: ./Foo does not match foo.ts', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/foo.ts': '',
    });
    expect(resolveRelative('./Foo', '/proj/src/index.ts', fs)).toBeNull();
  });

  it('returns null when the specifier is not relative', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/foo.ts': '',
    });
    expect(resolveRelative('foo', '/proj/src/index.ts', fs)).toBeNull();
    expect(resolveRelative('@scope/pkg', '/proj/src/index.ts', fs)).toBeNull();
    expect(resolveRelative('/abs/path.ts', '/proj/src/index.ts', fs)).toBeNull();
  });

  it('falls through to index.tsx when index.ts is absent', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/pkg/index.tsx': '',
    });
    expect(resolveRelative('./pkg', '/proj/src/index.ts', fs)).toBe('/proj/src/pkg/index.tsx');
  });

  it('does not match a directory whose name ends in a real extension', () => {
    // `./mod.ts` where mod.ts is a directory (rare but possible) — directory
    // hits don't satisfy the "must not be a directory" guard.
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/mod.ts/inner.ts': '',
    });
    expect(resolveRelative('./mod.ts', '/proj/src/index.ts', fs)).toBeNull();
  });
});
