/**
 * runtime-report.test.ts — Phase 3g Wave B acceptance suite for the
 * `RuntimeReport` schema + `emptyRuntimeReport` builder.
 */

import { describe, expect, it } from 'vitest';
import { type RuntimeReport, emptyRuntimeReport } from '../runtime-report.js';

describe('emptyRuntimeReport', () => {
  it('returns the canonical empty shape', () => {
    const r = emptyRuntimeReport();
    expect(r.schemaVersion).toBe(1);
    expect(r.hotPaths).toEqual([]);
    expect(r.coldCode).toEqual([]);
    expect(r.coverageMissing).toEqual([]);
    expect(r.weightedRefactorTargets).toEqual([]);
  });

  it('returned report and inner arrays are frozen', () => {
    const r = emptyRuntimeReport();
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.hotPaths)).toBe(true);
    expect(Object.isFrozen(r.coldCode)).toBe(true);
    expect(Object.isFrozen(r.coverageMissing)).toBe(true);
    expect(Object.isFrozen(r.weightedRefactorTargets)).toBe(true);
  });

  it('JSON.stringify is stable across calls (determinism)', () => {
    const a = emptyRuntimeReport();
    const b = emptyRuntimeReport();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('schema shape: every required field present', () => {
    const r: RuntimeReport = emptyRuntimeReport();
    const keys = Object.keys(r).sort();
    expect(keys).toEqual([
      'coldCode',
      'coverageMissing',
      'hotPaths',
      'schemaVersion',
      'weightedRefactorTargets',
    ]);
  });
});
