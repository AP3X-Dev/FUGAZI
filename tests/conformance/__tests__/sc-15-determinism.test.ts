/**
 * sc-15-determinism.test.ts — Phase 3m T291 — SC-15 acceptance row.
 *
 * SC-15: All 7 reporter formats produce byte-identical output across two
 * consecutive runs over the same fixture (with timestamps / version /
 * elapsedMs redacted).
 *
 * The reporter formats are:
 *   - human
 *   - human-plain
 *   - json
 *   - sarif
 *   - compact
 *   - markdown
 *   - codeclimate
 *
 * Strategy: build a tiny synthetic project, run `runAnalysis`, then for each
 * format drive a fresh `selectReporter(format)`, replay the issues + meta,
 * and capture the `end()` output. Run twice and assert byte-equal (post-
 * redaction).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import { type ReporterFormat, runAnalysis, selectReporter } from '@fugazi/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CONFIG: FugaziConfig = {
  rules: {},
  include: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
  exclude: ['node_modules', 'dist', 'build', 'coverage'],
  production: false,
  strict: false,
  experimentalTsPlugins: false,
} as FugaziConfig;

const FORMATS: readonly ReporterFormat[] = [
  'human',
  'human-plain',
  'json',
  'sarif',
  'compact',
  'markdown',
  'codeclimate',
];

let project: string;

async function captureFormat(projectRoot: string, format: ReporterFormat): Promise<string> {
  const result = await runAnalysis({ kind: 'full', config: CONFIG, projectRoot });
  const reporter = selectReporter(format);
  reporter.begin({
    mode: result._meta.mode,
    version: '0.0.0', // Pinned so SC-15 redaction is unnecessary.
    projectRoot,
  });
  for (const issue of result.issues) reporter.emit(issue);
  const payload = reporter.end();
  return typeof payload === 'string' ? payload : payload.toString('utf8');
}

// ANSI escape pattern: ESC [ <digits;digits...> m. Constructed from char
// codes so the literal control byte never appears in source (biome lint:
// noControlCharactersInRegex).
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g');

/**
 * Strip non-deterministic fields from a reporter payload so the byte-equal
 * comparison is stable. The driver sets `metrics.elapsedMs` and the JSON
 * reporter surfaces `_meta.timing` — both are redacted here. The
 * determinism hash is intentionally NOT redacted: it must match across runs
 * for a stable input.
 */
function redact(content: string): string {
  // Strip elapsedMs (numeric, e.g. `"elapsedMs": 12.34`)
  let out = content.replaceAll(/"elapsedMs"\s*:\s*[\d.]+/g, '"elapsedMs": 0');
  // Strip ANSI escape sequences for human format. PowerShell on Windows
  // sometimes emits CRLF — collapse to LF for cross-platform comparison.
  out = out.replaceAll(ANSI_ESCAPE_RE, '');
  out = out.replaceAll(/\r\n/g, '\n');
  return out;
}

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'fugazi-sc-15-'));
  const src = join(project, 'src');
  await mkdir(src, { recursive: true });
  await writeFile(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'sc-15-fixture', version: '0.0.0' })}\n`,
    'utf8',
  );
  await writeFile(join(src, 'a.ts'), 'export const a = 1;\n', 'utf8');
  await writeFile(
    join(src, 'b.ts'),
    "import { a } from './a.js';\nexport const b = a + 1;\n",
    'utf8',
  );
  await writeFile(join(src, 'c.ts'), "import { b } from './b.js';\nconsole.log(b);\n", 'utf8');
});

afterAll(async () => {
  if (project) await rm(project, { recursive: true, force: true });
});

describe('SC-15: output determinism across all 7 reporter formats', () => {
  for (const format of FORMATS) {
    it(`${format}: two consecutive runs produce byte-identical output`, async () => {
      const a = redact(await captureFormat(project, format));
      const b = redact(await captureFormat(project, format));
      expect(b).toBe(a);
      // Sanity: the output is non-empty for every format.
      expect(a.length).toBeGreaterThan(0);
    }, 60_000);
  }
});
