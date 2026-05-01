/**
 * workspace-discovery.test.ts — T042-test for `discoverWorkspaces` (T043).
 *
 * Covers npm/pnpm/yarn/bun workspace shapes plus single-package and edge
 * cases. Each scenario builds a self-contained tmp tree via `mkdtemp` so
 * tests do not share state. Cleanup runs in `afterEach`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverWorkspaces } from '../workspace-discovery.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-ws-discovery-'));
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

async function writePkg(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, 'package.json'), { name, version: '0.0.0' });
}

describe('discoverWorkspaces — single-package and missing root', () => {
  it('returns kind=single with empty packages when no package.json exists', async () => {
    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('single');
    expect(info.root).toBe(tmpRoot);
    expect(info.packages).toEqual([]);
  });

  it('returns kind=single when package.json exists but no lockfile present', async () => {
    await writeJson(join(tmpRoot, 'package.json'), { name: 'solo', version: '1.0.0' });
    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('single');
    expect(info.root).toBe(tmpRoot);
    expect(info.packages).toEqual([]);
  });

  it('returns kind=npm with empty packages when only package-lock.json exists and no workspaces field', async () => {
    await writeJson(join(tmpRoot, 'package.json'), { name: 'solo', version: '1.0.0' });
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');
    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('npm');
    expect(info.packages).toEqual([]);
  });
});

describe('discoverWorkspaces — npm workspaces', () => {
  it('detects npm workspaces with array form', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'monorepo',
      workspaces: ['packages/*', 'tools/*'],
    });
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');
    await writePkg(join(tmpRoot, 'packages', 'a'), 'a');
    await writePkg(join(tmpRoot, 'packages', 'b'), 'b');
    await writePkg(join(tmpRoot, 'tools', 'cli'), 'cli');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('npm');
    expect(info.root).toBe(tmpRoot);
    expect(info.packages).toEqual(
      [
        join(tmpRoot, 'packages', 'a'),
        join(tmpRoot, 'packages', 'b'),
        join(tmpRoot, 'tools', 'cli'),
      ].sort(),
    );
  });

  it('detects npm workspaces with object form { packages: [...] }', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'monorepo',
      workspaces: { packages: ['packages/*'], nohoist: ['**/foo'] },
    });
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');
    await writePkg(join(tmpRoot, 'packages', 'first'), 'first');
    await writePkg(join(tmpRoot, 'packages', 'second'), 'second');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('npm');
    expect(info.packages).toEqual(
      [join(tmpRoot, 'packages', 'first'), join(tmpRoot, 'packages', 'second')].sort(),
    );
  });
});

describe('discoverWorkspaces — yarn workspaces', () => {
  it('detects yarn kind via yarn.lock and reads workspaces from package.json', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'yarn-mono',
      workspaces: ['apps/*'],
    });
    await writeFile(join(tmpRoot, 'yarn.lock'), '# yarn lockfile v1\n', 'utf8');
    await writePkg(join(tmpRoot, 'apps', 'web'), 'web');
    await writePkg(join(tmpRoot, 'apps', 'api'), 'api');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('yarn');
    expect(info.packages).toEqual(
      [join(tmpRoot, 'apps', 'api'), join(tmpRoot, 'apps', 'web')].sort(),
    );
  });
});

describe('discoverWorkspaces — pnpm workspaces', () => {
  it('detects pnpm via pnpm-lock.yaml and reads pnpm-workspace.yaml', async () => {
    await writeJson(join(tmpRoot, 'package.json'), { name: 'pnpm-mono' });
    await writeFile(join(tmpRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
    await writeFile(
      join(tmpRoot, 'pnpm-workspace.yaml'),
      "packages:\n  - 'libs/*'\n  - 'apps/*'\n",
      'utf8',
    );
    await writePkg(join(tmpRoot, 'libs', 'shared'), 'shared');
    await writePkg(join(tmpRoot, 'apps', 'docs'), 'docs');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('pnpm');
    expect(info.packages).toEqual(
      [join(tmpRoot, 'apps', 'docs'), join(tmpRoot, 'libs', 'shared')].sort(),
    );
  });

  it('returns empty packages for pnpm when pnpm-workspace.yaml is missing', async () => {
    await writeJson(join(tmpRoot, 'package.json'), { name: 'pnpm-solo' });
    await writeFile(join(tmpRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('pnpm');
    expect(info.packages).toEqual([]);
  });
});

describe('discoverWorkspaces — bun workspaces', () => {
  it('detects bun via bun.lock and reads workspaces from package.json', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'bun-mono',
      workspaces: ['packages/*'],
    });
    await writeFile(join(tmpRoot, 'bun.lock'), '{}', 'utf8');
    await writePkg(join(tmpRoot, 'packages', 'one'), 'one');
    await writePkg(join(tmpRoot, 'packages', 'two'), 'two');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('bun');
    expect(info.packages).toEqual(
      [join(tmpRoot, 'packages', 'one'), join(tmpRoot, 'packages', 'two')].sort(),
    );
  });
});

describe('discoverWorkspaces — multi-lockfile priority', () => {
  it('prefers bun over pnpm/yarn/npm when multiple lockfiles are present', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'multi',
      workspaces: ['p/*'],
    });
    await writeFile(join(tmpRoot, 'bun.lock'), '{}', 'utf8');
    await writeFile(join(tmpRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
    await writeFile(join(tmpRoot, 'yarn.lock'), '# yarn lockfile v1\n', 'utf8');
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');
    await writePkg(join(tmpRoot, 'p', 'x'), 'x');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('bun');
    expect(info.packages).toEqual([join(tmpRoot, 'p', 'x')]);
  });

  it('prefers pnpm over yarn/npm when bun is absent', async () => {
    await writeJson(join(tmpRoot, 'package.json'), { name: 'multi' });
    await writeFile(join(tmpRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
    await writeFile(join(tmpRoot, 'yarn.lock'), '# yarn lockfile v1\n', 'utf8');
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('pnpm');
  });

  it('prefers yarn over npm when bun and pnpm are absent', async () => {
    await writeJson(join(tmpRoot, 'package.json'), { name: 'multi' });
    await writeFile(join(tmpRoot, 'yarn.lock'), '# yarn lockfile v1\n', 'utf8');
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('yarn');
  });
});

describe('discoverWorkspaces — edge cases', () => {
  it('returns empty packages for a glob that matches no directory', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'empty',
      workspaces: ['packages/*'],
    });
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.kind).toBe('npm');
    expect(info.packages).toEqual([]);
  });

  it('excludes glob-matched directories that lack a package.json', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'mixed',
      workspaces: ['packages/*'],
    });
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');
    await writePkg(join(tmpRoot, 'packages', 'real'), 'real');
    // A directory matching the glob with NO package.json — must be excluded.
    await mkdir(join(tmpRoot, 'packages', 'orphan'), { recursive: true });

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.packages).toEqual([join(tmpRoot, 'packages', 'real')]);
  });

  it('produces deduped lexicographically-sorted output', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'dedupe',
      workspaces: ['packages/*', 'packages/*'],
    });
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');
    await writePkg(join(tmpRoot, 'packages', 'z'), 'z');
    await writePkg(join(tmpRoot, 'packages', 'a'), 'a');
    await writePkg(join(tmpRoot, 'packages', 'm'), 'm');

    const info = await discoverWorkspaces(tmpRoot);
    expect(info.packages).toEqual([
      join(tmpRoot, 'packages', 'a'),
      join(tmpRoot, 'packages', 'm'),
      join(tmpRoot, 'packages', 'z'),
    ]);
  });

  it('is deterministic across two consecutive runs', async () => {
    await writeJson(join(tmpRoot, 'package.json'), {
      name: 'det',
      workspaces: ['p/*'],
    });
    await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');
    await writePkg(join(tmpRoot, 'p', 'b'), 'b');
    await writePkg(join(tmpRoot, 'p', 'a'), 'a');

    const a = await discoverWorkspaces(tmpRoot);
    const b = await discoverWorkspaces(tmpRoot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
