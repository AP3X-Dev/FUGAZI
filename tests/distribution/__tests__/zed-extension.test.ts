/**
 * Zed extension scaffold validation. v1.0 ships scaffold-only — these tests
 * just assert the manifest + language config + README are present and
 * structured correctly, with the v1.x deferral documented.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ZED = join(REPO_ROOT, 'editors', 'zed');

describe('Zed extension scaffold', () => {
  it('extension.toml exists and declares the LSP', () => {
    const toml = readFileSync(join(ZED, 'extension.toml'), 'utf8');
    expect(toml).toContain('[language_servers.fugazi]');
    expect(toml).toContain('TypeScript');
    expect(toml).toContain('JavaScript');
    expect(toml).toContain('Vue');
    expect(toml).toContain('Svelte');
    expect(toml).toContain('Astro');
  });

  it('language config exists', () => {
    const toml = readFileSync(join(ZED, 'languages', 'typescript.toml'), 'utf8');
    expect(toml).toContain('name = "TypeScript"');
    expect(toml).toContain('grammar = "typescript"');
    expect(toml).toContain('path_suffixes');
  });

  it('manual smoke instructions exist', () => {
    expect(existsSync(join(ZED, 'test', 'manual-smoke.md'))).toBe(true);
  });

  it('README documents the v1.0 scaffold-only status and prereq', () => {
    const md = readFileSync(join(ZED, 'README.md'), 'utf8');
    expect(md).toContain('scaffold only');
    expect(md).toContain('npm install -g fugazi');
    expect(md).toContain('Rust shim');
  });

  it('does NOT ship a src/lib.rs (Rust shim deferred to v1.x)', () => {
    expect(existsSync(join(ZED, 'src', 'lib.rs'))).toBe(false);
  });
});
