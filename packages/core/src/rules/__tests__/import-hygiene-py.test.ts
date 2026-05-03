/**
 * import-hygiene-py.test.ts — Phase 4c T332 acceptance suite.
 *
 * Per-file Python manifest walk: the rule walks from the importing `.py`
 * file's directory up to projectRoot looking for any of pyproject.toml,
 * setup.cfg, setup.py, requirements.txt; first hit wins. Bare imports of
 * undeclared packages → `unlisted-dependencies`; bare imports of declared
 * packages that fail to resolve → `unresolved-imports`.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import type { Inventory } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __clearImportHygieneCacheForTest,
  bareSpecifierToPyPackageName,
  createUnlistedDependenciesRule,
  createUnresolvedImportsRule,
} from '../import-hygiene.js';
import type { RuleContext } from '../types.js';

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

function emptyConfig(): FugaziConfig {
  return {
    rules: {},
    include: [],
    exclude: [],
    production: false,
    strict: false,
    experimentalTsPlugins: false,
  };
}

interface FileSpec {
  readonly path: string;
  readonly imports?: readonly { specifier: string; resolveTo?: string }[];
}

function buildFixture(specs: readonly FileSpec[]): {
  graph: Graph;
  fileNodes: ReadonlyMap<string, FileNode>;
} {
  const sorted = [...specs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const ids = assignFileIds(sorted.map((s) => s.path));
  const fileNodes = new Map<string, FileNode>();
  const filesById = new Map<FileId, FileNode>();
  for (const spec of sorted) {
    const id = ids.get(spec.path);
    if (id === undefined) throw new Error(`no id for ${spec.path}`);
    const inventory: Inventory = Object.freeze({
      lang: 'py',
      declarations: Object.freeze([]),
      imports: Object.freeze([]),
      usages: Object.freeze([]),
    });
    fileNodes.set(spec.path, { id, path: spec.path, inventory });
    filesById.set(id, { id, path: spec.path, inventory });
  }
  const edges: Edge[] = [];
  for (const spec of sorted) {
    const fromId = ids.get(spec.path);
    if (fromId === undefined) continue;
    for (const imp of spec.imports ?? []) {
      const target = imp.resolveTo;
      if (target !== undefined) {
        const toId = ids.get(target);
        if (toId !== undefined) {
          edges.push({
            from: fromId,
            to: toId,
            kind: 'static',
            specifier: imp.specifier,
            resolvable: true,
            loc: ZERO_RANGE,
          });
          continue;
        }
      }
      edges.push({
        from: fromId,
        to: ROOT_FILE_ID,
        kind: 'static',
        specifier: imp.specifier,
        resolvable: false,
        loc: ZERO_RANGE,
      });
    }
  }
  const edgesByTarget = new Map<FileId, Edge[]>();
  for (const edge of edges) {
    let bucket = edgesByTarget.get(edge.to);
    if (bucket === undefined) {
      bucket = [];
      edgesByTarget.set(edge.to, bucket);
    }
    bucket.push(edge);
  }
  return {
    graph: Object.freeze({ files: filesById, edges, edgesByTarget }),
    fileNodes,
  };
}

let projectRoot = '';

function ctx(fixture: ReturnType<typeof buildFixture>): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot,
    entryPoints: [],
    config: emptyConfig(),
  };
}

function writePyproject(content: string): void {
  writeFileSync(join(projectRoot, 'pyproject.toml'), content, 'utf8');
}

function writeRequirementsTxt(content: string): void {
  writeFileSync(join(projectRoot, 'requirements.txt'), content, 'utf8');
}

describe('import-hygiene — Python manifest walk (T332)', () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'fugazi-import-hygiene-py-')).split('\\').join('/');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('Python file imports declared package → no unlisted flag', () => {
    writePyproject(`[project]
name = "demo"
dependencies = ["requests>=2.0"]
`);
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: 'requests' }] },
    ]);
    expect(createUnlistedDependenciesRule('error')(ctx(fix))).toEqual([]);
  });

  it('Python file imports undeclared package → flagged unlisted', () => {
    writePyproject(`[project]
name = "demo"
dependencies = []
`);
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: 'lodash_py' }] },
    ]);
    const findings = createUnlistedDependenciesRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unlisted-dependencies') throw new Error('expected');
    expect(f.specifier).toBe('lodash_py');
  });

  it('Python file imports declared but missing package → flagged unresolved (not unlisted)', () => {
    writePyproject(`[project]
name = "demo"
dependencies = ["requests>=2.0"]
`);
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: 'requests' }] },
    ]);
    const findings = createUnresolvedImportsRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unresolved-imports') throw new Error('expected');
    expect(f.specifier).toBe('requests');
  });

  it('nested module access (`urllib.request`) matches manifest entry `urllib`', () => {
    writePyproject(`[project]
name = "demo"
dependencies = ["urllib"]
`);
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: 'urllib.request' }] },
    ]);
    expect(createUnlistedDependenciesRule('error')(ctx(fix))).toEqual([]);
  });

  it('nested module access (`urllib.request`) without manifest entry → flagged unlisted', () => {
    writePyproject(`[project]
name = "demo"
dependencies = []
`);
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: 'urllib.request' }] },
    ]);
    const findings = createUnlistedDependenciesRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unlisted-dependencies') throw new Error('expected');
    expect(f.specifier).toBe('urllib.request');
  });

  it('PEP 503 normalization: manifest `Django-REST-Framework` matches import `django_rest_framework`', () => {
    writePyproject(`[project]
name = "demo"
dependencies = ["Django-REST-Framework>=3.0"]
`);
    const fix = buildFixture([
      {
        path: `${projectRoot}/app.py`,
        imports: [{ specifier: 'django_rest_framework' }],
      },
    ]);
    expect(createUnlistedDependenciesRule('error')(ctx(fix))).toEqual([]);
  });

  it('Python file with requirements.txt: declared in manifest → no flag', () => {
    writeRequirementsTxt('requests>=2.0\nflask==2.0.0\n');
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: 'flask' }] },
    ]);
    expect(createUnlistedDependenciesRule('error')(ctx(fix))).toEqual([]);
  });

  it('Python file with no manifest at all → all bare imports flagged unlisted', () => {
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: 'requests' }] },
    ]);
    const findings = createUnlistedDependenciesRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
  });

  it('Python file relative import → not classified as unlisted/unresolved bare', () => {
    // The visitor records relative imports with leading dots which our
    // bareSpecifierToPyPackageName returns undefined for; rule treats as
    // unresolved (relative path that didn't resolve).
    writePyproject(`[project]
name = "demo"
dependencies = []
`);
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: '.utils' }] },
    ]);
    const unlisted = createUnlistedDependenciesRule('error')(ctx(fix));
    expect(unlisted).toEqual([]);
    const unresolved = createUnresolvedImportsRule('error')(ctx(fix));
    expect(unresolved.length).toBe(1);
  });

  it('verbatim Python message references pyproject.toml', () => {
    writePyproject(`[project]
name = "demo"
dependencies = []
`);
    const fix = buildFixture([
      { path: `${projectRoot}/app.py`, imports: [{ specifier: 'requests' }] },
    ]);
    const findings = createUnlistedDependenciesRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe(
      'unlisted-dependencies: requests is not declared in pyproject.toml',
    );
    __clearImportHygieneCacheForTest(ctx(fix));
  });

  describe('bareSpecifierToPyPackageName', () => {
    it('plain module → itself (PEP 503 lower-cased / normalized)', () => {
      expect(bareSpecifierToPyPackageName('django')).toBe('django');
      expect(bareSpecifierToPyPackageName('Django')).toBe('django');
      expect(bareSpecifierToPyPackageName('Django_Rest_Framework')).toBe('django-rest-framework');
    });

    it('dotted module → leading segment', () => {
      expect(bareSpecifierToPyPackageName('urllib.request')).toBe('urllib');
      expect(bareSpecifierToPyPackageName('django.contrib.admin')).toBe('django');
    });

    it('relative imports → undefined', () => {
      expect(bareSpecifierToPyPackageName('.')).toBeUndefined();
      expect(bareSpecifierToPyPackageName('.foo')).toBeUndefined();
      expect(bareSpecifierToPyPackageName('..bar')).toBeUndefined();
    });

    it('empty / scheme-prefixed → undefined', () => {
      expect(bareSpecifierToPyPackageName('')).toBeUndefined();
      expect(bareSpecifierToPyPackageName('node:fs')).toBeUndefined();
    });
  });
});
