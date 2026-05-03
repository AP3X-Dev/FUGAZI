/**
 * namespace-pkg.test.ts — Phase 4b T319 acceptance suite for PEP 420
 * namespace package helpers.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../../resolve/fs-adapter.js';
import { findPackageRoot, isAnyPackage, isRegularPackage } from '../namespace-pkg.js';

describe('namespace-pkg helpers (T319)', () => {
  it('isRegularPackage returns true for directories with __init__.py', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/mod.py': '',
    });
    expect(isRegularPackage('/proj/pkg', fs)).toBe(true);
  });

  it('isRegularPackage returns true for directories with __init__.pyi', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.pyi': '',
    });
    expect(isRegularPackage('/proj/pkg', fs)).toBe(true);
  });

  it('isRegularPackage returns false for namespace packages (no __init__.py)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/ns/sub/leaf.py': '',
    });
    expect(isRegularPackage('/proj/ns', fs)).toBe(false);
    expect(isRegularPackage('/proj/ns/sub', fs)).toBe(false);
  });

  it('isAnyPackage returns true for any existing directory', () => {
    const fs = createMemoryFsAdapter({
      '/proj/ns/sub/leaf.py': '',
      '/proj/pkg/__init__.py': '',
    });
    expect(isAnyPackage('/proj/ns', fs)).toBe(true);
    expect(isAnyPackage('/proj/ns/sub', fs)).toBe(true);
    expect(isAnyPackage('/proj/pkg', fs)).toBe(true);
    expect(isAnyPackage('/proj/missing', fs)).toBe(false);
  });

  it('findPackageRoot returns own dir for files outside packages', () => {
    const fs = createMemoryFsAdapter({
      '/proj/mod.py': '',
    });
    expect(findPackageRoot('/proj', fs)).toBe('/proj');
  });

  it('findPackageRoot walks up through chains of __init__.py', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/sub/__init__.py': '',
      '/proj/pkg/sub/mod.py': '',
    });
    // From sub: walk up to pkg (still has __init__.py), then stop because /proj
    // has no __init__.py.
    expect(findPackageRoot('/proj/pkg/sub', fs)).toBe('/proj/pkg');
  });

  it('findPackageRoot stops at the topmost __init__.py-bearing directory', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/mod.py': '',
    });
    expect(findPackageRoot('/proj/pkg', fs)).toBe('/proj/pkg');
  });
});
