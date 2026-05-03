/**
 * sc-1.test.ts — Phase 3m T281 — SC-1 acceptance row.
 *
 * SC-1 requires that all 8 conformance fixtures produce stable output and
 * that the `basic` fixture is frozen on first run. The actual byte-equality
 * assertions live in `conformance.test.ts` (which iterates every fixture
 * directory). This file is a thin acceptance gate that:
 *
 *   1. asserts the conformance fixtures directory exists,
 *   2. asserts at least 8 fixture sub-directories are present,
 *   3. asserts every fixture has an `expected.json` (i.e. is frozen),
 *   4. asserts the `basic` fixture is one of them and has a non-empty freeze.
 *
 * If `conformance.test.ts` regresses, it fails first; this file confirms
 * the structural pre-conditions independent of the runner.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', 'fixtures');

function listFixtures(): readonly string[] {
  if (!existsSync(FIXTURES_ROOT)) return [];
  return readdirSync(FIXTURES_ROOT)
    .filter((name) => statSync(resolve(FIXTURES_ROOT, name)).isDirectory())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('SC-1: 8 conformance fixtures + basic freeze', () => {
  it('the conformance fixtures root exists', () => {
    expect(existsSync(FIXTURES_ROOT)).toBe(true);
  });

  it('at least 8 fixture directories are present', () => {
    const fixtures = listFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  it('every fixture has a frozen expected.json', () => {
    const fixtures = listFixtures();
    for (const name of fixtures) {
      const expectedPath = resolve(FIXTURES_ROOT, name, 'expected.json');
      expect(existsSync(expectedPath), `${name} is missing expected.json`).toBe(true);
      const content = readFileSync(expectedPath, 'utf8');
      expect(content.length, `${name}/expected.json is empty`).toBeGreaterThan(0);
    }
  });

  it('the `basic` fixture is present and frozen', () => {
    const fixtures = listFixtures();
    expect(fixtures).toContain('basic');
    const basicExpected = resolve(FIXTURES_ROOT, 'basic', 'expected.json');
    expect(existsSync(basicExpected)).toBe(true);
    const content = readFileSync(basicExpected, 'utf8');
    // Canonical JSON: ends with LF, parses as JSON.
    expect(content.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
