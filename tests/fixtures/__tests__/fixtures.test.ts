/**
 * fixtures.test.ts — Phase 3k.1 — representative project fixtures.
 *
 * Walks every `<theme>/<name>/` subdirectory under `tests/fixtures/`, runs
 * the analyzer, and asserts byte-equality with each fixture's frozen
 * `expected.json`. Themes covered: boundary, re-export, suppression,
 * path-aliases, workspace, frameworks.
 *
 * Each fixture is a small (≤5 file) project that exercises one specific
 * surface. The freeze captures the analyzer's current behaviour — divergence
 * from spec is a v1 limitation, not a fixture bug.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freezeFixture } from '../../fixture-runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

interface DiscoveredFixture {
  readonly theme: string;
  readonly name: string;
  readonly dir: string;
}

function discover(): readonly DiscoveredFixture[] {
  if (!existsSync(ROOT)) return [];
  const themes = readdirSync(ROOT)
    .filter((name) => {
      if (name === '__tests__') return false;
      const full = resolve(ROOT, name);
      return statSync(full).isDirectory();
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: DiscoveredFixture[] = [];
  for (const theme of themes) {
    const themeDir = resolve(ROOT, theme);
    const entries = readdirSync(themeDir)
      .filter((name) => statSync(resolve(themeDir, name)).isDirectory())
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of entries) {
      out.push({ theme, name, dir: resolve(themeDir, name) });
    }
  }
  return out;
}

describe('project fixtures', () => {
  const fixtures = discover();

  it('discovers at least 30 fixtures across themes', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
  });

  it.each(fixtures.map((f) => [`${f.theme}/${f.name}`, f.dir]))(
    'byte-equality: %s',
    async (_id, dir) => {
      const result = await freezeFixture(dir);
      if (result.actual !== result.expected) {
        const a = result.actual.split('\n');
        const e = result.expected.split('\n');
        const lines: string[] = [];
        for (let i = 0; i < Math.max(a.length, e.length); i++) {
          if (a[i] !== e[i]) {
            lines.push(`L${i} exp=${JSON.stringify(e[i] ?? null)} got=${JSON.stringify(a[i] ?? null)}`);
          }
        }
        // TEMP diagnostic — unique marker to grep out of CI log noise.
        console.error(`__WINDIFF__ ${_id}\n${lines.slice(0, 40).join('\n')}\n__WINDIFFEND__`);
      }
      expect(result.actual).toBe(result.expected);
    },
  );
});
