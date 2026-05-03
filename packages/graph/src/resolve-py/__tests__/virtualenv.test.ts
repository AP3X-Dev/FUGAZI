/**
 * virtualenv.test.ts — Phase 4b T320 acceptance suite for virtualenv detection
 * and site-packages resolution.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../../resolve/fs-adapter.js';
import { findVirtualenv, resolveInVirtualenv } from '../virtualenv.js';

describe('Python virtualenv detection (T320)', () => {
  it('detects .venv on Windows-style layout', () => {
    const fs = createMemoryFsAdapter({
      '/proj/.venv/Lib/site-packages/requests/__init__.py': '',
    });
    expect(findVirtualenv('/proj', fs)).toBe('/proj/.venv/Lib/site-packages');
  });

  it('detects .venv on POSIX-style layout (python3.11)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/.venv/lib/python3.11/site-packages/requests/__init__.py': '',
    });
    expect(findVirtualenv('/proj', fs)).toBe('/proj/.venv/lib/python3.11/site-packages');
  });

  it('detects venv (no leading dot) when .venv absent', () => {
    const fs = createMemoryFsAdapter({
      '/proj/venv/Lib/site-packages/x.py': '',
    });
    expect(findVirtualenv('/proj', fs)).toBe('/proj/venv/Lib/site-packages');
  });

  it('returns null when no virtualenv directory is present', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
    });
    expect(findVirtualenv('/proj', fs)).toBeNull();
  });

  it('returns null when venv exists but site-packages cannot be located', () => {
    const fs = createMemoryFsAdapter({
      // .venv/ exists but no Lib/site-packages or lib/pythonX.Y/site-packages.
      '/proj/.venv/bin/python': '',
    });
    expect(findVirtualenv('/proj', fs)).toBeNull();
  });

  it('prefers .venv over venv when both exist', () => {
    const fs = createMemoryFsAdapter({
      '/proj/.venv/Lib/site-packages/x.py': '',
      '/proj/venv/Lib/site-packages/y.py': '',
    });
    expect(findVirtualenv('/proj', fs)).toBe('/proj/.venv/Lib/site-packages');
  });
});

describe('resolveInVirtualenv', () => {
  it('resolves a top-level package via __init__.py', () => {
    const fs = createMemoryFsAdapter({
      '/sp/requests/__init__.py': '',
    });
    expect(resolveInVirtualenv('requests', '/sp', fs)).toBe('/sp/requests/__init__.py');
  });

  it('resolves a single-file module', () => {
    const fs = createMemoryFsAdapter({
      '/sp/six.py': '',
    });
    expect(resolveInVirtualenv('six', '/sp', fs)).toBe('/sp/six.py');
  });

  it('resolves a dotted import via leading-segment match', () => {
    const fs = createMemoryFsAdapter({
      '/sp/numpy/__init__.py': '',
    });
    expect(resolveInVirtualenv('numpy.linalg', '/sp', fs)).toBe('/sp/numpy/__init__.py');
  });

  it('returns null for missing packages', () => {
    const fs = createMemoryFsAdapter({});
    expect(resolveInVirtualenv('missing', '/sp', fs)).toBeNull();
  });

  it('rejects relative-style and empty input', () => {
    const fs = createMemoryFsAdapter({ '/sp/foo.py': '' });
    expect(resolveInVirtualenv('', '/sp', fs)).toBeNull();
    expect(resolveInVirtualenv('.foo', '/sp', fs)).toBeNull();
  });
});
