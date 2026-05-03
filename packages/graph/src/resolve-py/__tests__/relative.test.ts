/**
 * relative.test.ts — Phase 4b T318 acceptance suite for the Python relative
 * import resolver.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../../resolve/fs-adapter.js';
import { parseRelativeSpec, resolvePyRelative } from '../relative.js';

describe('parseRelativeSpec', () => {
  it('parses single-dot specifier with no module', () => {
    expect(parseRelativeSpec('.')).toEqual({ level: 1, parts: [] });
  });

  it('parses double-dot specifier with no module', () => {
    expect(parseRelativeSpec('..')).toEqual({ level: 2, parts: [] });
  });

  it('parses single-dot with module', () => {
    expect(parseRelativeSpec('.foo')).toEqual({ level: 1, parts: ['foo'] });
  });

  it('parses double-dot with dotted module', () => {
    expect(parseRelativeSpec('..foo.bar')).toEqual({ level: 2, parts: ['foo', 'bar'] });
  });

  it('returns null for non-relative input', () => {
    expect(parseRelativeSpec('foo.bar')).toBeNull();
    expect(parseRelativeSpec('')).toBeNull();
  });
});

describe('Python relative import resolution (T318)', () => {
  it('resolves `from . import x` to the package __init__.py', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/mod.py': '',
    });
    expect(resolvePyRelative('.', '/proj/pkg/mod.py', fs)).toBe('/proj/pkg/__init__.py');
  });

  it('resolves `from .foo import x` to /proj/pkg/foo.py', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/mod.py': '',
      '/proj/pkg/foo.py': '',
    });
    expect(resolvePyRelative('.foo', '/proj/pkg/mod.py', fs)).toBe('/proj/pkg/foo.py');
  });

  it('resolves `from ..foo import x` from a nested file', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/sub/__init__.py': '',
      '/proj/pkg/sub/mod.py': '',
      '/proj/pkg/foo.py': '',
    });
    expect(resolvePyRelative('..foo', '/proj/pkg/sub/mod.py', fs)).toBe('/proj/pkg/foo.py');
  });

  it('resolves `from ..foo.bar import x` to /proj/pkg/foo/bar.py', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/sub/__init__.py': '',
      '/proj/pkg/sub/mod.py': '',
      '/proj/pkg/foo/__init__.py': '',
      '/proj/pkg/foo/bar.py': '',
    });
    expect(resolvePyRelative('..foo.bar', '/proj/pkg/sub/mod.py', fs)).toBe('/proj/pkg/foo/bar.py');
  });

  it('resolves `from ...foo import x` (level 3) from doubly-nested file', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/sub/__init__.py': '',
      '/proj/pkg/sub/inner/__init__.py': '',
      '/proj/pkg/sub/inner/mod.py': '',
      '/proj/pkg/sub/foo.py': '',
      '/proj/pkg/foo.py': '',
      '/proj/foo.py': '',
    });
    // Per PEP 328: level=2 (`..`) skips one level above the current package.
    // Current package = inner. `..foo` walks up 1 → sub → resolves to sub/foo.
    expect(resolvePyRelative('..foo', '/proj/pkg/sub/inner/mod.py', fs)).toBe(
      '/proj/pkg/sub/foo.py',
    );
    // level=3 (`...`) walks up 2 → pkg → pkg/foo.
    expect(resolvePyRelative('...foo', '/proj/pkg/sub/inner/mod.py', fs)).toBe('/proj/pkg/foo.py');
    // level=4 (`....`) walks up 3 → /proj → /proj/foo.
    expect(resolvePyRelative('....foo', '/proj/pkg/sub/inner/mod.py', fs)).toBe('/proj/foo.py');
  });

  it('resolves a relative subpackage to its __init__.py', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/mod.py': '',
      '/proj/pkg/sub/__init__.py': '',
    });
    expect(resolvePyRelative('.sub', '/proj/pkg/mod.py', fs)).toBe('/proj/pkg/sub/__init__.py');
  });

  it('falls back to .pyi stub when .py is absent', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/mod.py': '',
      '/proj/pkg/foo.pyi': '',
    });
    expect(resolvePyRelative('.foo', '/proj/pkg/mod.py', fs)).toBe('/proj/pkg/foo.pyi');
  });

  it('returns null on miss', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/mod.py': '',
    });
    expect(resolvePyRelative('.nonexistent', '/proj/pkg/mod.py', fs)).toBeNull();
  });

  it('handles over-dotting (more dots than directories above) gracefully', () => {
    const fs = createMemoryFsAdapter({
      '/proj/mod.py': '',
    });
    // Three dots from `/proj/mod.py` would go above /, which is impossible.
    expect(resolvePyRelative('....foo', '/proj/mod.py', fs)).toBeNull();
  });

  it('resolves a relative import from a file outside any package (PEP 420 ish)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/mod.py': '',
      '/proj/sibling.py': '',
      // No __init__.py in /proj/.
    });
    // The file itself is the package root; `.sibling` resolves to the sibling.
    expect(resolvePyRelative('.sibling', '/proj/mod.py', fs)).toBe('/proj/sibling.py');
  });
});
