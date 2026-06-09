import { type FileNode, createMemoryFsAdapter, nodeFsAdapter } from '@fugazi/graph';
import { describe, expect, it } from 'vitest';
import { inferEntryPoints } from '../infer-entrypoints.js';

/** Build a fileNodes map (keyed by absolute POSIX path) from relative paths. */
function nodes(root: string, rels: readonly string[]): Map<string, FileNode> {
  const m = new Map<string, FileNode>();
  rels.forEach((rel, i) => {
    const path = `${root}/${rel}`;
    m.set(path, {
      id: i as unknown as FileNode['id'],
      path,
      inventory: { declarations: [], imports: [], usages: [] },
    } as unknown as FileNode);
  });
  return m;
}

const EMPTY_FS = createMemoryFsAdapter({});
const rel = (root: string, paths: readonly string[]) => paths.map((p) => p.slice(root.length + 1));

describe('inferEntryPoints — conventions', () => {
  it('recognises common JS/TS entries and test/config files, excludes plain modules', () => {
    const root = '/p';
    const files = [
      'index.ts',
      'src/index.ts',
      'src/main.ts',
      'cli.ts',
      'src/server.ts',
      'vite.config.ts',
      'foo.test.ts',
      'src/__tests__/unit.ts',
      'tests/e2e.spec.ts',
      'src/util.ts', // imported helper — NOT an entry
      'src/orphan.ts', // genuinely dead — NOT an entry
    ];
    const got = rel(root, inferEntryPoints(root, nodes(root, files), EMPTY_FS));
    expect(got).toContain('index.ts');
    expect(got).toContain('src/index.ts');
    expect(got).toContain('src/main.ts');
    expect(got).toContain('cli.ts');
    expect(got).toContain('src/server.ts');
    expect(got).toContain('vite.config.ts');
    expect(got).toContain('foo.test.ts');
    expect(got).toContain('src/__tests__/unit.ts');
    expect(got).toContain('tests/e2e.spec.ts');
    expect(got).not.toContain('src/util.ts');
    expect(got).not.toContain('src/orphan.ts');
  });

  it('recognises Python execution conventions (nested and root)', () => {
    const root = '/p';
    const files = [
      'pkg/__main__.py',
      'manage.py',
      'app.py',
      'conftest.py',
      'tests/test_api.py',
      'pkg/widget_test.py',
      'pkg/widget.py', // plain module — NOT an entry
    ];
    const got = rel(root, inferEntryPoints(root, nodes(root, files), EMPTY_FS));
    expect(got).toContain('pkg/__main__.py');
    expect(got).toContain('manage.py');
    expect(got).toContain('app.py');
    expect(got).toContain('conftest.py');
    expect(got).toContain('tests/test_api.py');
    expect(got).toContain('pkg/widget_test.py');
    expect(got).not.toContain('pkg/widget.py');
  });

  it('returns a sorted, de-duplicated list', () => {
    const root = '/p';
    const got = inferEntryPoints(
      root,
      nodes(root, ['src/index.ts', 'index.ts', 'cli.ts']),
      EMPTY_FS,
    );
    expect(got).toEqual([...got].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(got).size).toBe(got.length);
  });
});

describe('inferEntryPoints — package.json manifest', () => {
  it('resolves bin / main / module / exports targets in non-conventional locations', () => {
    const root = '/p';
    const fs = createMemoryFsAdapter({
      '/p/package.json': JSON.stringify({
        main: 'src/electron/main.js', // non-conventional — only findable via manifest
        module: 'src/esm/entry.mjs',
        bin: { tool: 'app/run.ts' },
        exports: { '.': './lib/index.js', './sub': { import: './lib/sub.mjs' } },
      }),
    });
    const files = [
      'src/electron/main.js',
      'src/esm/entry.mjs',
      'app/run.ts',
      'lib/index.js',
      'lib/sub.mjs',
      'src/unrelated.ts',
    ];
    const got = rel(root, inferEntryPoints(root, nodes(root, files), fs));
    expect(got).toEqual(
      expect.arrayContaining([
        'src/electron/main.js',
        'src/esm/entry.mjs',
        'app/run.ts',
        'lib/index.js',
        'lib/sub.mjs',
      ]),
    );
    expect(got).not.toContain('src/unrelated.ts');
  });

  it('resolves an extensionless main against source extensions', () => {
    const root = '/p';
    const fs = createMemoryFsAdapter({ '/p/package.json': JSON.stringify({ main: 'src/index' }) });
    const got = rel(root, inferEntryPoints(root, nodes(root, ['src/index.ts']), fs));
    expect(got).toContain('src/index.ts');
  });

  it('contributes nothing for build-output targets absent from the source set', () => {
    const root = '/p';
    const fs = createMemoryFsAdapter({
      '/p/package.json': JSON.stringify({ main: 'dist/index.js' }),
    });
    // dist/index.js is not in fileNodes (it is build output, excluded from analysis).
    const got = inferEntryPoints(root, nodes(root, ['src/core.ts']), fs);
    expect(got).toEqual([]);
  });
});

describe('inferEntryPoints — pyproject scripts', () => {
  it('adds resolved console-script modules present in the file set', () => {
    const root = '/p';
    const fs = createMemoryFsAdapter({
      '/p/pyproject.toml': '[project.scripts]\napp = "pkg.cli:main"\n',
      '/p/pkg/__init__.py': '',
      '/p/pkg/cli.py': '',
    });
    const got = rel(
      root,
      inferEntryPoints(root, nodes(root, ['pkg/__init__.py', 'pkg/cli.py']), fs),
    );
    expect(got).toContain('pkg/cli.py');
  });
});

describe('inferEntryPoints — guards', () => {
  it('returns [] for an empty file set', () => {
    expect(inferEntryPoints('/p', new Map(), nodeFsAdapter)).toEqual([]);
  });
});
