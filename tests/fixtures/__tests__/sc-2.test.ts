/**
 * sc-2.test.ts — Phase 3m T282 — SC-2 acceptance row.
 *
 * SC-2 calls for a target corpus of 145 project fixtures. v1.0
 * ships 34 representative fixtures across 6 themes (boundary, frameworks,
 * path-aliases, re-export, suppression, workspace). The remaining 111 are
 * carried to v1.x.
 *
 * The actual byte-equality assertions live in `fixtures.test.ts`. This file
 * is the SC-2 row gate:
 *
 *   1. assert at least 30 fixtures exist (matches the existing minimum),
 *   2. enumerate themes covered,
 *   3. mark the YELLOW status (34/145) explicitly so reviewers see the carry.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..');

interface DiscoveredFixture {
  readonly theme: string;
  readonly name: string;
  readonly dir: string;
}

function discover(): readonly DiscoveredFixture[] {
  if (!existsSync(FIXTURES_ROOT)) return [];
  const themes = readdirSync(FIXTURES_ROOT)
    .filter((name) => {
      if (name === '__tests__') return false;
      return statSync(resolve(FIXTURES_ROOT, name)).isDirectory();
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: DiscoveredFixture[] = [];
  for (const theme of themes) {
    const themeDir = resolve(FIXTURES_ROOT, theme);
    const names = readdirSync(themeDir)
      .filter((name) => statSync(resolve(themeDir, name)).isDirectory())
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) out.push({ theme, name, dir: resolve(themeDir, name) });
  }
  return out;
}

describe('SC-2: representative project fixtures (34 of 145 — v1.0 carry)', () => {
  const fixtures = discover();

  it('discovers at least 30 fixtures (v1.0 minimum surface)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
  });

  it('covers the six v1.0 themes', () => {
    const themes = new Set(fixtures.map((f) => f.theme));
    expect(themes.has('boundary')).toBe(true);
    expect(themes.has('frameworks')).toBe(true);
    expect(themes.has('path-aliases')).toBe(true);
    expect(themes.has('re-export')).toBe(true);
    expect(themes.has('suppression')).toBe(true);
    expect(themes.has('workspace')).toBe(true);
  });

  it('every fixture has a frozen expected.json (byte-equality is enforced by fixtures.test.ts)', () => {
    for (const fix of fixtures) {
      const expected = resolve(fix.dir, 'expected.json');
      expect(existsSync(expected), `${fix.theme}/${fix.name} is missing expected.json`).toBe(true);
    }
  });
});
