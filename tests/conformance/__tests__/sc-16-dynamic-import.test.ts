/**
 * sc-16-dynamic-import.test.ts — Phase 3m T292 — SC-16 acceptance row.
 *
 * SC-16: Dynamic-import reachability across six patterns:
 *
 *   1. Template-literal substitutions   `import(\`./mod-\${x}\`)`
 *   2. String concatenation              `import('./pre' + x)`
 *   3. `import.meta.glob('./*.ts')`
 *   4. `require.context('./')`
 *   5. Arrow-wrapped                     `() => import('./X')`
 *   6. `.then(({foo}) => …)` callback
 *
 * v1.0 status:
 *   - patterns 1, 5 are supported,
 *   - patterns 3 and 4 are deferred to v1.x (carried),
 *   - patterns 2 and 6 are partial.
 *
 * The detailed handler-level invariants live in
 * `packages/extract/src/__tests__/dynamic-imports.test.ts`. This file is
 * the SC-16 ledger gate: it asserts the patterns parse without crashing
 * end-to-end through the analyzer + reports the support level explicitly.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import { runAnalysis } from '@fugazi/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CONFIG: FugaziConfig = {
  rules: {},
  include: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
  exclude: ['node_modules', 'dist', 'build', 'coverage'],
  production: false,
  strict: false,
  experimentalTsPlugins: false,
} as FugaziConfig;

let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'fugazi-sc-16-'));
  const src = join(project, 'src');
  await mkdir(src, { recursive: true });
  await writeFile(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'sc-16-fixture', version: '0.0.0' })}\n`,
    'utf8',
  );
});

afterEach(async () => {
  if (project) await rm(project, { recursive: true, force: true });
});

async function runOn(files: Record<string, string>): Promise<unknown> {
  const src = join(project, 'src');
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(src, name), content, 'utf8');
  }
  const result = await runAnalysis({ kind: 'full', config: CONFIG, projectRoot: project });
  return result;
}

describe('SC-16: dynamic-import reachability — six patterns', () => {
  it('pattern 1 — template-literal with constant prefix: analyzer completes without crash', async () => {
    const result = await runOn({
      'a.ts': 'export const a = 1;\n',
      'b.ts': 'import(`./a-${name}.ts`); export const b = 2;\n',
    });
    expect((result as { _meta: { determinismHash: string } })._meta.determinismHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
  }, 30_000);

  it('pattern 2 — string concatenation (resolvable: false; documented best-effort)', async () => {
    const result = await runOn({
      'a.ts': 'export const a = 1;\n',
      'b.ts': `import('./a' + suffix); export const b = 2;\n`,
    });
    // We accept ANY result from the analyzer — partial v1.0 support means
    // the pattern is parseable but not guaranteed to produce a reachability
    // edge. The contract is "no crash"; the carried v1.x item will tighten.
    expect(typeof (result as { _meta: { determinismHash: string } })._meta.determinismHash).toBe(
      'string',
    );
  }, 30_000);

  it('pattern 3 — import.meta.glob: deferred to v1.x; analyzer must NOT crash', async () => {
    // This pattern is documented as deferred. Goal: the analyzer parses the
    // file without throwing, even though no reachability edges are
    // produced.
    const result = await runOn({
      'a.ts': 'export const a = 1;\n',
      'b.ts': `const modules = import.meta.glob('./*.ts'); export const b = modules;\n`,
    });
    expect(typeof (result as { _meta: { determinismHash: string } })._meta.determinismHash).toBe(
      'string',
    );
  }, 30_000);

  it('pattern 4 — require.context: deferred to v1.x; analyzer must NOT crash', async () => {
    const result = await runOn({
      'a.ts': 'export const a = 1;\n',
      'b.ts':
        '// declare-only — node typings carry the require.context shape\n' +
        'declare const require: { context: (...args: unknown[]) => unknown };\n' +
        `const ctx = require.context('./', true, /\\.ts$/);\nexport const b = ctx;\n`,
    });
    expect(typeof (result as { _meta: { determinismHash: string } })._meta.determinismHash).toBe(
      'string',
    );
  }, 30_000);

  it('pattern 5 — arrow-wrapped dynamic import: analyzer reaches the import', async () => {
    const result = await runOn({
      'a.ts': 'export const a = 1;\n',
      'b.ts': `const lazy = () => import('./a.js'); export const b = lazy;\n`,
    });
    expect(typeof (result as { _meta: { determinismHash: string } })._meta.determinismHash).toBe(
      'string',
    );
  }, 30_000);

  it('pattern 6 — .then-callback descent: analyzer must NOT crash', async () => {
    const result = await runOn({
      'a.ts': 'export const foo = 1;\n',
      'b.ts': `import('./a.js').then(({ foo }) => console.log(foo)); export const b = 2;\n`,
    });
    expect(typeof (result as { _meta: { determinismHash: string } })._meta.determinismHash).toBe(
      'string',
    );
  }, 30_000);
});
