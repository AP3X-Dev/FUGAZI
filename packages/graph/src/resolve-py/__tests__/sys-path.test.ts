/**
 * sys-path.test.ts — Phase 4b T317 acceptance suite for the Python sys.path
 * resolver. Also exercises PEP 420 namespace-package resolution (T319) since
 * the probe strategy is namespace-aware by design.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../../resolve/fs-adapter.js';
import { buildSysPathRoots, resolveSysPath } from '../sys-path.js';

describe('Python sys.path resolution (T317)', () => {
  it('resolves a single-segment module to <root>/foo.py', () => {
    const fs = createMemoryFsAdapter({
      '/proj/foo.py': '',
    });
    expect(resolveSysPath('foo', '/proj', fs)).toBe('/proj/foo.py');
  });

  it('resolves a single-segment package to <root>/foo/__init__.py', () => {
    const fs = createMemoryFsAdapter({
      '/proj/foo/__init__.py': '',
    });
    expect(resolveSysPath('foo', '/proj', fs)).toBe('/proj/foo/__init__.py');
  });

  it('falls through to <root>/src/foo.py when src/ exists and root miss', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/foo.py': '',
    });
    expect(resolveSysPath('foo', '/proj', fs)).toBe('/proj/src/foo.py');
  });

  it('resolves dotted depth-2 imports', () => {
    const fs = createMemoryFsAdapter({
      '/proj/foo/bar.py': '',
      '/proj/foo/__init__.py': '',
    });
    expect(resolveSysPath('foo.bar', '/proj', fs)).toBe('/proj/foo/bar.py');
  });

  it('resolves dotted depth-3 imports', () => {
    const fs = createMemoryFsAdapter({
      '/proj/foo/bar/baz.py': '',
      '/proj/foo/bar/__init__.py': '',
      '/proj/foo/__init__.py': '',
    });
    expect(resolveSysPath('foo.bar.baz', '/proj', fs)).toBe('/proj/foo/bar/baz.py');
  });

  it('falls back to .pyi stub when .py is absent', () => {
    const fs = createMemoryFsAdapter({
      '/proj/foo.pyi': '',
    });
    expect(resolveSysPath('foo', '/proj', fs)).toBe('/proj/foo.pyi');
  });

  it('returns null on miss', () => {
    const fs = createMemoryFsAdapter({});
    expect(resolveSysPath('nonexistent', '/proj', fs)).toBeNull();
  });

  it('rejects empty / relative input', () => {
    const fs = createMemoryFsAdapter({ '/proj/.foo.py': '' });
    expect(resolveSysPath('', '/proj', fs)).toBeNull();
    expect(resolveSysPath('.foo', '/proj', fs)).toBeNull();
    expect(resolveSysPath('foo..bar', '/proj', fs)).toBeNull();
  });

  it('prefers root over src/ when both contain the module', () => {
    const fs = createMemoryFsAdapter({
      '/proj/foo.py': '',
      '/proj/src/foo.py': '',
    });
    expect(resolveSysPath('foo', '/proj', fs)).toBe('/proj/foo.py');
  });

  it('prefers .py over .pyi when both exist', () => {
    const fs = createMemoryFsAdapter({
      '/proj/foo.py': '',
      '/proj/foo.pyi': '',
    });
    expect(resolveSysPath('foo', '/proj', fs)).toBe('/proj/foo.py');
  });
});

describe('PEP 420 namespace package resolution (T319)', () => {
  it('resolves through directories without __init__.py (namespace package)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/ns/sub/leaf.py': '',
      // No __init__.py in /proj/ns/ or /proj/ns/sub/.
    });
    expect(resolveSysPath('ns.sub.leaf', '/proj', fs)).toBe('/proj/ns/sub/leaf.py');
  });

  it('resolves through mixed regular/namespace packages', () => {
    const fs = createMemoryFsAdapter({
      '/proj/ns/__init__.py': '', // regular pkg
      '/proj/ns/sub/leaf.py': '', // namespace inside regular
    });
    expect(resolveSysPath('ns.sub.leaf', '/proj', fs)).toBe('/proj/ns/sub/leaf.py');
  });

  it('resolves a regular package with __init__.py at every level', () => {
    const fs = createMemoryFsAdapter({
      '/proj/a/__init__.py': '',
      '/proj/a/b/__init__.py': '',
      '/proj/a/b/c.py': '',
    });
    expect(resolveSysPath('a.b.c', '/proj', fs)).toBe('/proj/a/b/c.py');
  });

  it('does not resolve a bare namespace directory (no concrete file)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/ns/sub/leaf.py': '', // makes /proj/ns/sub/ exist as dir
    });
    // Asking for `ns` alone has no concrete file — namespace dirs without
    // __init__.py are not a hit.
    expect(resolveSysPath('ns', '/proj', fs)).toBeNull();
  });
});

describe('sys.path root construction', () => {
  it('returns just project root when src/ is absent', () => {
    const fs = createMemoryFsAdapter({});
    expect(buildSysPathRoots('/proj', fs)).toEqual(['/proj']);
  });

  it('appends src/ when present', () => {
    const fs = createMemoryFsAdapter({ '/proj/src/x.py': '' });
    expect(buildSysPathRoots('/proj', fs)).toEqual(['/proj', '/proj/src']);
  });
});
