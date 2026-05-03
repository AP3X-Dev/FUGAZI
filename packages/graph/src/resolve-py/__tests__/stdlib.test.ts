/**
 * stdlib.test.ts — Phase 4b T321 acceptance suite for the Python stdlib
 * allowlist.
 */

import { describe, expect, it } from 'vitest';
import { PYTHON_STDLIB_MODULES, isPythonStdlib } from '../stdlib.js';

describe('Python stdlib allowlist (T321)', () => {
  it('accepts common top-level stdlib modules', () => {
    for (const m of ['os', 'sys', 'json', 'asyncio', 're', 'collections', 'typing']) {
      expect(isPythonStdlib(m)).toBe(true);
    }
  });

  it('accepts dotted stdlib subpaths via leading-segment match', () => {
    expect(isPythonStdlib('os.path')).toBe(true);
    expect(isPythonStdlib('urllib.request')).toBe(true);
    expect(isPythonStdlib('email.mime.text')).toBe(true);
    expect(isPythonStdlib('xml.etree.ElementTree')).toBe(true);
  });

  it('rejects third-party packages with stdlib-prefix collisions', () => {
    expect(isPythonStdlib('requests')).toBe(false);
    expect(isPythonStdlib('numpy')).toBe(false);
    // `picklepickle` is not stdlib even though `pickle` is.
    expect(isPythonStdlib('picklepickle')).toBe(false);
    expect(isPythonStdlib('jsonschema')).toBe(false);
  });

  it('rejects empty input and relative imports', () => {
    expect(isPythonStdlib('')).toBe(false);
    expect(isPythonStdlib('.')).toBe(false);
    expect(isPythonStdlib('.foo')).toBe(false);
    expect(isPythonStdlib('..bar.baz')).toBe(false);
  });

  it('exposes the underlying frozen set for callers that need direct access', () => {
    expect(PYTHON_STDLIB_MODULES.has('os')).toBe(true);
    expect(PYTHON_STDLIB_MODULES.has('typing')).toBe(true);
    expect(PYTHON_STDLIB_MODULES.has('not-a-real-module')).toBe(false);
    // The set itself is the canonical export; consumers should treat it as
    // readonly. We document the contract via the type system, not runtime
    // enforcement (Object.freeze does not deep-freeze the underlying Set).
    expect(typeof PYTHON_STDLIB_MODULES.has).toBe('function');
  });

  it('contains a representative sample of >100 modules (sanity check)', () => {
    expect(PYTHON_STDLIB_MODULES.size).toBeGreaterThan(150);
    // Spot checks across categories.
    expect(PYTHON_STDLIB_MODULES.has('abc')).toBe(true);
    expect(PYTHON_STDLIB_MODULES.has('argparse')).toBe(true);
    expect(PYTHON_STDLIB_MODULES.has('dataclasses')).toBe(true);
    expect(PYTHON_STDLIB_MODULES.has('itertools')).toBe(true);
    expect(PYTHON_STDLIB_MODULES.has('subprocess')).toBe(true);
    expect(PYTHON_STDLIB_MODULES.has('zipfile')).toBe(true);
  });
});
