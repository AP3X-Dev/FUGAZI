/**
 * conformance.test.ts — Phase 3k.2 — byte-equality conformance suite.
 *
 * For each fixture under `tests/conformance/fixtures/<name>/`, run the
 * analyzer and assert byte-equality against the fixture's `expected.json`.
 * SC-1 hinges on this: the same fixture must produce the same canonical
 * JSON every run.
 *
 * To freeze a brand-new fixture, set FUGAZI_FREEZE=1 — the runner writes the
 * `expected.json` for any fixture that lacks one. Subsequent runs always
 * compare; freezing twice is a no-op for already-frozen fixtures.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freezeFixture } from '../../fixture-runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', 'fixtures');

function listFixtures(): readonly string[] {
  if (!existsSync(FIXTURES_ROOT)) return [];
  return readdirSync(FIXTURES_ROOT)
    .filter((name) => {
      const full = resolve(FIXTURES_ROOT, name);
      return statSync(full).isDirectory();
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('conformance fixtures', () => {
  const fixtures = listFixtures();

  it('discovers at least one fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('byte-equality: %s', async (name) => {
    const dir = resolve(FIXTURES_ROOT, name);
    const result = await freezeFixture(dir);
    expect(result.actual).toBe(result.expected);
  });

  it('determinism: each fixture produces identical output across consecutive runs', async () => {
    for (const name of fixtures) {
      const dir = resolve(FIXTURES_ROOT, name);
      const a = await freezeFixture(dir);
      const b = await freezeFixture(dir);
      expect(b.actual).toBe(a.actual);
    }
  }, 60_000);
});
