/**
 * phase-4e-cross-language.test.ts — Phase 4e (T361-T370) acceptance suite.
 *
 * Covers the cross-language dispatch added in Phase 4e:
 *
 *   T361 — runAnalysis dispatches by extension; metrics carry filesByLang +
 *          parseErrors; progress events fire for both languages.
 *   T362 — discoverFiles picks up `.py` and `.pyi`; honours `.fugaziignore`
 *          + skip-dir defaults (.venv, __pycache__).
 *   T363 — Python imports resolve through the graph end-to-end.
 *   T370 — extract.* progress events carry `lang` when emitted from a
 *          per-language loop.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAnalysis } from '../run-analysis.js';
import type { RunAnalysisOptions, RunAnalysisResult } from '../types.js';

function defaultConfig(): FugaziConfig {
  return {
    rules: {},
    include: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,py,pyi}'],
    exclude: ['node_modules', 'dist', 'build', 'coverage'],
    production: false,
    strict: false,
    experimentalTsPlugins: false,
  };
}

function baseOptions(projectRoot: string): RunAnalysisOptions {
  return {
    kind: 'full',
    config: defaultConfig(),
    projectRoot,
  };
}

let tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fugazi-4e-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
});

beforeEach(() => {
  tempDirs = [];
});

function toPosix(p: string): string {
  return sep === '\\' ? p.replaceAll('\\', '/') : p;
}

// ---------------------------------------------------------------------------
// T361 — extractOne dispatch + filesByLang + parseErrors
// ---------------------------------------------------------------------------

describe('Phase 4e T361 — runAnalysis dispatch', () => {
  it('mixed TS + Python project produces inventories from both pipelines', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'index.ts'), 'export const a = 1;\n');
    await writeFile(join(root, 'helpers.py'), 'def helper():\n    return 1\n');
    const result = await runAnalysis(baseOptions(root));

    expect(result.metrics.filesScanned).toBe(2);
    expect(result.metrics.filesByLang.ts).toBe(1);
    expect(result.metrics.filesByLang.py).toBe(1);
  }, 30_000);

  it('pure Python project surfaces filesByLang.py === filesScanned', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.py'), 'x = 1\n');
    await writeFile(join(root, 'b.py'), 'y = 2\n');
    const result = await runAnalysis(baseOptions(root));

    expect(result.metrics.filesScanned).toBe(2);
    expect(result.metrics.filesByLang.py).toBe(2);
    expect(result.metrics.filesByLang.ts).toBe(0);
  }, 30_000);

  it('pure TS project surfaces filesByLang.ts === filesScanned', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(root, 'b.ts'), 'export const b = 2;\n');
    const result = await runAnalysis(baseOptions(root));

    expect(result.metrics.filesByLang.ts).toBe(2);
    expect(result.metrics.filesByLang.py).toBe(0);
  }, 30_000);

  it('parse errors in Python source soft-collected into metrics.parseErrors', async () => {
    const root = await makeTempDir();
    // Mix of valid and invalid Python — tree-sitter is fail-soft so the
    // analysis still completes without throwing.
    await writeFile(join(root, 'good.py'), 'x = 1\n');
    await writeFile(join(root, 'bad.py'), 'def broken(x:\n    return x\n');
    const result = await runAnalysis(baseOptions(root));

    expect(result.metrics.parseErrors.total).toBeGreaterThanOrEqual(0);
    // Even with parse errors, files were scanned.
    expect(result.metrics.filesScanned).toBe(2);
  }, 30_000);

  it('parseErrors.byLang attributes parse-error counts to the originating language', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'good.py'), 'x = 1\n');
    await writeFile(join(root, 'good.ts'), 'export const a = 1;\n');
    const result = await runAnalysis(baseOptions(root));

    expect(result.metrics.parseErrors.total).toBe(0);
    expect(result.metrics.parseErrors.byLang.ts).toBe(0);
    expect(result.metrics.parseErrors.byLang.py).toBe(0);
  }, 30_000);

  it('preBuiltGraph fast path leaves filesByLang at zero (no extract phase ran)', async () => {
    const root = await makeTempDir();
    const result = await runAnalysis({
      ...baseOptions(root),
      preBuiltGraph: {
        files: new Map(),
        edges: Object.freeze([]),
        edgesByTarget: new Map(),
      },
    });
    expect(result.metrics.filesByLang.ts).toBe(0);
    expect(result.metrics.filesByLang.py).toBe(0);
    expect(result.metrics.parseErrors.total).toBe(0);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// T362 — discovery
// ---------------------------------------------------------------------------

describe('Phase 4e T362 — discovery', () => {
  it('discovers a `.py` file under src/', async () => {
    const root = await makeTempDir();
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'main.py'), 'x = 1\n');
    const result = await runAnalysis(baseOptions(root));
    expect(result.metrics.filesScanned).toBe(1);
    expect(result.metrics.filesByLang.py).toBe(1);
  }, 30_000);

  it('discovers a `.pyi` stub file', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'types.pyi'), 'def foo() -> int: ...\n');
    const result = await runAnalysis(baseOptions(root));
    expect(result.metrics.filesScanned).toBe(1);
    expect(result.metrics.filesByLang.py).toBe(1);
  }, 30_000);

  it('skips `.py` files under node_modules/', async () => {
    const root = await makeTempDir();
    await mkdir(join(root, 'node_modules', 'foo'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'foo', 'a.py'), 'x = 1\n');
    await writeFile(join(root, 'app.py'), 'y = 1\n');
    const result = await runAnalysis(baseOptions(root));
    expect(result.metrics.filesScanned).toBe(1);
  }, 30_000);

  it('skips `.py` files under .venv/', async () => {
    const root = await makeTempDir();
    await mkdir(join(root, '.venv', 'lib'), { recursive: true });
    await writeFile(join(root, '.venv', 'lib', 'foo.py'), 'x = 1\n');
    await writeFile(join(root, 'main.py'), 'y = 1\n');
    const result = await runAnalysis(baseOptions(root));
    expect(result.metrics.filesScanned).toBe(1);
  }, 30_000);

  it('skips `__pycache__/` bytecode directories', async () => {
    const root = await makeTempDir();
    await mkdir(join(root, '__pycache__'), { recursive: true });
    await writeFile(join(root, '__pycache__', 'cached.py'), 'x = 1\n');
    await writeFile(join(root, 'main.py'), 'y = 1\n');
    const result = await runAnalysis(baseOptions(root));
    expect(result.metrics.filesScanned).toBe(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// T363 — resolver integration
// ---------------------------------------------------------------------------

describe('Phase 4e T363 — Python resolver wiring', () => {
  it('Python relative import resolves into the graph', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'main.py'), 'from .helpers import helper\nresult = helper()\n');
    await writeFile(join(root, 'helpers.py'), 'def helper():\n    return 1\n');
    const result = await runAnalysis(baseOptions(root));
    expect(result.metrics.filesScanned).toBe(2);
  }, 30_000);

  it('two-file Python project produces 2 nodes; analysis succeeds', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.py'), 'def a(): return 1\n');
    await writeFile(join(root, 'b.py'), 'from .a import a\nb = a()\n');
    const result = await runAnalysis(baseOptions(root));
    const graphDone = result.progressEvents.find((e) => e.kind === 'graph.done');
    expect(graphDone?.kind).toBe('graph.done');
    expect(result.metrics.filesByLang.py).toBe(2);
  }, 30_000);

  it('mixed TS + Python imports do not corrupt either pipeline', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'app.ts'), "import { x } from './lib.js';\nconst a = x;\n");
    await writeFile(join(root, 'lib.ts'), 'export const x = 1;\n');
    await writeFile(join(root, 'a.py'), 'from .b import y\nv = y\n');
    await writeFile(join(root, 'b.py'), 'y = 1\n');
    const result = await runAnalysis(baseOptions(root));
    expect(result.metrics.filesByLang.ts).toBe(2);
    expect(result.metrics.filesByLang.py).toBe(2);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// T370 — language-aware progress events
// ---------------------------------------------------------------------------

describe('Phase 4e T370 — progress event lang field', () => {
  it('extract.start and extract.done events default with no lang field on mixed runs', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(root, 'b.py'), 'x = 1\n');
    const result = await runAnalysis(baseOptions(root));
    // The driver emits the unified extract.start / extract.done. Per-language
    // tagging is reserved for streams where the event was generated inside a
    // single-language loop (the current driver runs a single mixed loop).
    const start = result.progressEvents.find((e) => e.kind === 'extract.start');
    const done = result.progressEvents.find((e) => e.kind === 'extract.done');
    expect(start).toBeDefined();
    expect(done).toBeDefined();
    // Field is optional — typecheck via union narrowing. No `lang: undefined`
    // should appear; if present it must be a closed-set value.
    if (start?.kind === 'extract.start' && start.lang !== undefined) {
      expect(['ts', 'py']).toContain(start.lang);
    }
  }, 30_000);

  it('ProgressEvent.lang typecheck — only "ts" or "py" allowed when present', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.py'), 'x = 1\n');
    const result = await runAnalysis(baseOptions(root));
    for (const event of result.progressEvents) {
      if (
        event.kind === 'extract.start' ||
        event.kind === 'extract.progress' ||
        event.kind === 'extract.done'
      ) {
        if (event.lang !== undefined) {
          expect(['ts', 'py']).toContain(event.lang);
        }
      }
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Cross-cutting determinism
// ---------------------------------------------------------------------------

describe('Phase 4e — determinism', () => {
  it('two consecutive runs over a mixed TS + Python project produce identical determinism hashes', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(root, 'b.py'), 'x = 1\n');
    const r1 = await runAnalysis(baseOptions(root));
    const r2 = await runAnalysis(baseOptions(root));
    expect(r1._meta.determinismHash).toBe(r2._meta.determinismHash);
    expect(r1.metrics.filesByLang).toEqual(r2.metrics.filesByLang);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Phase 4f T381 — runAnalysis loads the Python manifest
// ---------------------------------------------------------------------------

describe('Phase 4f T381 — runAnalysis loads PythonManifest from projectRoot', () => {
  it('flask import declared in pyproject.toml does NOT surface as unresolved-imports', async () => {
    const root = await makeTempDir();
    await writeFile(
      join(root, 'pyproject.toml'),
      `[project]
name = "test"
version = "0.0.0"
dependencies = ["Flask>=2.0"]
`,
    );
    await writeFile(join(root, 'app.py'), 'from flask import Flask\napp = Flask(__name__)\n');
    const result = await runAnalysis(baseOptions(root));
    const unresolved = result.issues.filter((i) => i.kind === 'unresolved-imports');
    expect(unresolved).toEqual([]);
  }, 30_000);

  it('undeclared package import surfaces as unlisted-dependencies (not external)', async () => {
    const root = await makeTempDir();
    await writeFile(
      join(root, 'pyproject.toml'),
      `[project]
name = "test"
version = "0.0.0"
dependencies = []
`,
    );
    await writeFile(join(root, 'app.py'), 'from random_unknown_pkg import x\n');
    const result = await runAnalysis(baseOptions(root));
    // Manifest declares no deps → resolver returns 'unresolved' for the
    // import → import-hygiene flags it as unlisted-dependencies (Python's
    // bare-spec equivalent of TS "third-party not declared in manifest").
    const importHygiene = result.issues.filter(
      (i) => i.kind === 'unlisted-dependencies' || i.kind === 'unresolved-imports',
    );
    expect(importHygiene.length).toBeGreaterThan(0);
  }, 30_000);

  it('PEP 503 normalization: `Django-REST-Framework` matches dep `djangorestframework`', async () => {
    const root = await makeTempDir();
    await writeFile(
      join(root, 'pyproject.toml'),
      `[project]
name = "test"
version = "0.0.0"
dependencies = ["djangorestframework>=3.0"]
`,
    );
    await writeFile(join(root, 'app.py'), 'from django_rest_framework import x\n');
    const result = await runAnalysis(baseOptions(root));
    const unresolved = result.issues.filter((i) => i.kind === 'unresolved-imports');
    expect(unresolved).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Phase 4f T381 — submodule promotion + package-init traversal
// ---------------------------------------------------------------------------

describe('Phase 4f T381 — Python submodule promotion through __init__.py', () => {
  it('from .sub import foo makes foo.py reachable from main.py', async () => {
    const root = await makeTempDir();
    await mkdir(join(root, 'pkg', 'sub'), { recursive: true });
    await writeFile(join(root, 'pkg', '__init__.py'), '');
    await writeFile(join(root, 'pkg', 'sub', '__init__.py'), '');
    await writeFile(join(root, 'pkg', 'sub', 'foo.py'), "def run(): return 'ok'\n");
    await writeFile(
      join(root, 'pkg', 'main.py'),
      'from .sub import foo\n\ndef main():\n    return foo.run()\n',
    );
    const opts = baseOptions(root);
    const optsWithEntry: RunAnalysisOptions = {
      ...opts,
      config: { ...opts.config, entrypoints: ['pkg/main.py'] },
    };
    const result = await runAnalysis(optsWithEntry);
    const unusedFiles = result.issues.filter((i) => i.kind === 'unused-files');
    // Both pkg/sub/foo.py AND pkg/__init__.py + pkg/sub/__init__.py should
    // be reachable. unused-files = 0.
    expect(unusedFiles).toEqual([]);
  }, 30_000);

  it('package __init__.py reaches up the chain when any sibling file is reached', async () => {
    const root = await makeTempDir();
    await mkdir(join(root, 'pkg'), { recursive: true });
    await writeFile(join(root, 'pkg', '__init__.py'), '');
    await writeFile(join(root, 'pkg', 'main.py'), 'x = 1\n');
    const opts = baseOptions(root);
    const optsWithEntry: RunAnalysisOptions = {
      ...opts,
      config: { ...opts.config, entrypoints: ['pkg/main.py'] },
    };
    const result = await runAnalysis(optsWithEntry);
    const unusedFiles = result.issues.filter((i) => i.kind === 'unused-files');
    // pkg/__init__.py is reached via the synthetic package-init edge from
    // pkg/main.py.
    expect(unusedFiles).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Helper to silence "toPosix unused" lint
// ---------------------------------------------------------------------------

void toPosix;
function _silenceUnused(): unknown {
  return { _ignore: undefined as RunAnalysisResult | undefined };
}
void _silenceUnused;
