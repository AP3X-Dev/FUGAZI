/**
 * contract.test.ts — Phase 3h.5 (T204) — public-surface contract checks.
 *
 * Asserts the SIX-function surface defined by IMP-ARCH-11 and the
 * collapsed-helper requirement from IMP-API-02 (the original Fallow
 * `detect_dead_code`, `detect_unused_files`, `detect_unused_exports` are NOT
 * exported — `analyze({ rules: [...] })` replaces them).
 */

import { describe, expect, it } from 'vitest';
import * as nodeApi from '../index.js';

const REQUIRED_FUNCTIONS = [
  'analyze',
  'audit',
  'findDupes',
  'health',
  'traceExport',
  'traceFile',
] as const;

const FORBIDDEN_NAMES = ['detectDeadCode', 'detectUnusedFiles', 'detectUnusedExports'] as const;

describe('@fugazi/node contract', () => {
  it('exports exactly the six public functions', () => {
    for (const name of REQUIRED_FUNCTIONS) {
      expect(nodeApi).toHaveProperty(name);
      expect(typeof (nodeApi as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('does not export the collapsed Fallow helpers (IMP-API-02)', () => {
    for (const forbidden of FORBIDDEN_NAMES) {
      expect((nodeApi as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });

  it('the function set is exactly the six listed names (plus types)', () => {
    const exported = Object.keys(nodeApi).filter(
      (k) => typeof (nodeApi as Record<string, unknown>)[k] === 'function',
    );
    expect([...exported].sort()).toEqual([...REQUIRED_FUNCTIONS].sort());
  });
});
