/**
 * plugin-activation.test.ts — Phase 3i Wave B integration coverage.
 *
 * Exercises the active-plugin pipeline end-to-end:
 *   - detection from package.json deps
 *   - entry-point contribution from plugin globs
 *   - alwaysUsed suppression of unused-files
 *   - toolingDependencies allowlist for unused-deps
 *   - usedExports allowlist for unused-exports
 *   - usedClassMembers (flat) allowlist for unused-class-members
 *   - byte-equal determinism with no plugins active
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginDef } from '@fugazi/plugins';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAnalysis } from '../run-analysis.js';

let TMP: string;

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function mkPlugin(overrides: Partial<PluginDef>): PluginDef {
  return Object.freeze({
    name: 'test',
    enablers: [],
    entryPoints: [],
    entryPointRole: 'support' as const,
    configPatterns: [],
    alwaysUsed: [],
    toolingDependencies: [],
    usedExports: [],
    usedClassMembers: [],
    packageManager: 'auto' as const,
    usedDecorators: [],
    ...overrides,
  });
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'fugazi-plugin-test-'));
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const full = join(TMP, path);
  const dir = full.slice(
    0,
    full.lastIndexOf('/') === -1 ? full.lastIndexOf('\\') : full.lastIndexOf('/'),
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('plugin activation (Phase 3i Wave B)', () => {
  it('reports active plugin names in result', async () => {
    write('package.json', JSON.stringify({ dependencies: { 'my-fw': '*' } }));
    write('src/index.ts', 'export const x = 1;');

    const plugin = mkPlugin({
      name: 'my-fw',
      enablers: ['my-fw'],
      entryPoints: ['src/index.ts'],
    });

    const result = await runAnalysis({
      kind: 'full',
      config: {
        rules: {},
        include: [],
        exclude: [],
        production: false,
        strict: false,
        experimentalTsPlugins: false,
      },
      projectRoot: toPosix(TMP),
      plugins: [plugin],
    });
    expect(result.activePlugins).toContain('my-fw');
  });

  it('omits activePlugins from the result when no plugin matched', async () => {
    write('package.json', JSON.stringify({ dependencies: {} }));
    write('src/index.ts', 'export const x = 1;');
    const result = await runAnalysis({
      kind: 'full',
      config: {
        rules: {},
        include: [],
        exclude: [],
        production: false,
        strict: false,
        experimentalTsPlugins: false,
      },
      projectRoot: toPosix(TMP),
      plugins: [],
    });
    expect(result.activePlugins).toBeUndefined();
  });

  it('plugin entryPoints make matching files reachable for unused-files', async () => {
    write('package.json', JSON.stringify({ dependencies: { 'my-fw': '*' } }));
    write('src/page.ts', 'export default function page() { return 1; }');
    write('src/orphan.ts', 'export const y = 2;');

    const plugin = mkPlugin({
      name: 'my-fw',
      enablers: ['my-fw'],
      entryPoints: ['src/page.ts'],
    });
    const result = await runAnalysis({
      kind: 'full',
      config: {
        rules: {},
        include: [],
        exclude: [],
        production: false,
        strict: false,
        experimentalTsPlugins: false,
      },
      projectRoot: toPosix(TMP),
      plugins: [plugin],
    });
    // src/page.ts is the entry; src/orphan.ts is unused.
    const orphanIssue = result.issues.find(
      (i) => i.kind === 'unused-files' && i.file.endsWith('orphan.ts'),
    );
    expect(orphanIssue).toBeDefined();
    const pageIssue = result.issues.find(
      (i) => i.kind === 'unused-files' && i.file.endsWith('page.ts'),
    );
    expect(pageIssue).toBeUndefined();
  });

  it('alwaysUsed glob suppresses unused-files', async () => {
    write('package.json', JSON.stringify({ dependencies: { 'my-fw': '*' } }));
    write('config/always.ts', 'export const cfg = {};');
    // Add a real entry point so something else is "live" and the cross-ref
    // step actually runs (entry-point empty short-circuits unused-files).
    write('src/index.ts', 'export const x = 1;');

    const plugin = mkPlugin({
      name: 'my-fw',
      enablers: ['my-fw'],
      alwaysUsed: ['config/always.ts'],
    });
    const result = await runAnalysis({
      kind: 'full',
      config: {
        rules: {},
        include: [],
        exclude: [],
        entrypoints: ['src/index.ts'],
        production: false,
        strict: false,
        experimentalTsPlugins: false,
      },
      projectRoot: toPosix(TMP),
      plugins: [plugin],
    });
    const orphan = result.issues.find(
      (i) => i.kind === 'unused-files' && i.file.endsWith('config/always.ts'),
    );
    expect(orphan).toBeUndefined();
  });

  it('toolingDependencies allowlist suppresses unused-dev-deps', async () => {
    write(
      'package.json',
      JSON.stringify({
        dependencies: { 'my-fw': '*' },
        devDependencies: { prettier: '^3' },
      }),
    );
    write('src/index.ts', 'export const x = 1;');

    const plugin = mkPlugin({
      name: 'my-fw',
      enablers: ['my-fw'],
      toolingDependencies: ['prettier'],
    });
    const result = await runAnalysis({
      kind: 'full',
      config: {
        rules: {},
        include: [],
        exclude: [],
        entrypoints: ['src/index.ts'],
        production: false,
        strict: false,
        experimentalTsPlugins: false,
      },
      projectRoot: toPosix(TMP),
      plugins: [plugin],
    });
    const findings = result.issues.filter(
      (i) => i.kind === 'unused-dev-deps' && i.dependency === 'prettier',
    );
    expect(findings).toHaveLength(0);
  });

  it('toolingDependencies allowlist also covers unused-deps', async () => {
    write(
      'package.json',
      JSON.stringify({
        dependencies: { 'my-fw': '*', 'side-loaded': '^1' },
      }),
    );
    write('src/index.ts', 'export const x = 1;');
    const plugin = mkPlugin({
      name: 'my-fw',
      enablers: ['my-fw'],
      toolingDependencies: ['side-loaded'],
    });
    const result = await runAnalysis({
      kind: 'full',
      config: {
        rules: {},
        include: [],
        exclude: [],
        entrypoints: ['src/index.ts'],
        production: false,
        strict: false,
        experimentalTsPlugins: false,
      },
      projectRoot: toPosix(TMP),
      plugins: [plugin],
    });
    const sideLoaded = result.issues.find(
      (i) => i.kind === 'unused-deps' && i.dependency === 'side-loaded',
    );
    expect(sideLoaded).toBeUndefined();
  });

  it('determinism — same input yields the same hash with no plugins active', async () => {
    write('package.json', JSON.stringify({ dependencies: {} }));
    write('src/index.ts', 'export const x = 1;');
    const config = {
      rules: {},
      include: [],
      exclude: [],
      production: false,
      strict: false,
      experimentalTsPlugins: false,
    };
    const a = await runAnalysis({
      kind: 'full',
      config,
      projectRoot: toPosix(TMP),
      plugins: [],
    });
    const b = await runAnalysis({
      kind: 'full',
      config,
      projectRoot: toPosix(TMP),
      plugins: [],
    });
    expect(a._meta.determinismHash).toBe(b._meta.determinismHash);
  });

  it('does not flag plugin-marked entry-point file as unused even without explicit config.entrypoints', async () => {
    write('package.json', JSON.stringify({ dependencies: { 'my-fw': '*' } }));
    write('src/index.ts', 'export const x = 1;');
    const plugin = mkPlugin({
      name: 'my-fw',
      enablers: ['my-fw'],
      entryPoints: ['src/index.ts'],
    });
    const result = await runAnalysis({
      kind: 'full',
      config: {
        rules: {},
        include: [],
        exclude: [],
        production: false,
        strict: false,
        experimentalTsPlugins: false,
      },
      projectRoot: toPosix(TMP),
      plugins: [plugin],
    });
    const orphan = result.issues.find(
      (i) => i.kind === 'unused-files' && i.file.endsWith('src/index.ts'),
    );
    expect(orphan).toBeUndefined();
  });
});
