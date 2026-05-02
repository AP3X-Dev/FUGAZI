/**
 * unused-deps.test.ts — Phase 3f.2 Wave 2 (T142) acceptance suite.
 *
 * In-memory module-graph fixtures + transient on-disk package.json. The test
 * fabricates a tempdir under `os.tmpdir()` for each fixture so the rule can
 * read a real package.json via `node:fs`.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RuleContext } from '../types.js';
import {
  __clearUnusedDepsCacheForTest,
  createUnusedDepsRule,
  createUnusedDevDepsRule,
  createUnusedOptionalDepsRule,
} from '../unused-deps.js';

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

function makeConfig(production = false): FugaziConfig {
  return {
    rules: {},
    include: [],
    exclude: [],
    production,
    strict: false,
    experimentalTsPlugins: false,
  };
}

interface FileSpec {
  readonly path: string;
  readonly bareImports?: readonly string[];
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
    const node: FileNode = {
      id,
      path: spec.path,
      inventory: Object.freeze({
        declarations: Object.freeze([]),
        imports: Object.freeze([]),
        usages: Object.freeze([]),
      }),
    };
    fileNodes.set(spec.path, node);
    filesById.set(id, node);
  }
  const edges: Edge[] = [];
  for (const spec of sorted) {
    const fromId = ids.get(spec.path);
    if (fromId === undefined) continue;
    for (const bare of spec.bareImports ?? []) {
      edges.push({
        from: fromId,
        to: ROOT_FILE_ID,
        kind: 'static',
        specifier: bare,
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

function ctx(
  fixture: ReturnType<typeof buildFixture>,
  config: FugaziConfig = makeConfig(),
): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot,
    entryPoints: [],
    config,
  };
}

function writeManifest(content: object): void {
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify(content), 'utf8');
}

describe('unused-deps family', () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'fugazi-unused-deps-')).split('\\').join('/');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('(a) declared dep not imported → flagged by unused-deps', () => {
    writeManifest({ dependencies: { react: '^18', lodash: '^4' } });
    const fix = buildFixture([{ path: '/proj/a.ts', bareImports: ['react'] }]);
    const rule = createUnusedDepsRule('error');
    const findings = rule(ctx(fix));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'unused-deps') throw new Error('unexpected');
    expect(finding.dependency).toBe('lodash');
    expect(finding.manifestPath.endsWith('/package.json')).toBe(true);
  });

  it('(b) scoped subpath import counts toward the scoped package', () => {
    writeManifest({ dependencies: { '@babel/core': '^7' } });
    const fix = buildFixture([{ path: '/proj/a.ts', bareImports: ['@babel/core/lib/api'] }]);
    const rule = createUnusedDepsRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('(c) unused-dev-deps reports devDependencies separately', () => {
    writeManifest({
      dependencies: { react: '^18' },
      devDependencies: { vitest: '^2', eslint: '^9' },
    });
    const fix = buildFixture([{ path: '/proj/a.ts', bareImports: ['react', 'vitest'] }]);
    const findings = createUnusedDevDepsRule('warn')(ctx(fix));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'unused-dev-deps') throw new Error('x');
    expect(finding.dependency).toBe('eslint');
    expect(finding.severity).toBe('warn');
  });

  it('(d) production:true short-circuits dev-deps and optional-deps', () => {
    writeManifest({
      devDependencies: { unused: '^1' },
      optionalDependencies: { fsevents: '^2' },
    });
    const fix = buildFixture([]);
    const productionCtx = ctx(fix, makeConfig(true));
    expect(createUnusedDevDepsRule('error')(productionCtx)).toEqual([]);
    expect(createUnusedOptionalDepsRule('error')(productionCtx)).toEqual([]);
  });

  it('(e) missing package.json → all three rules emit nothing (no throw)', () => {
    // Don't write a manifest.
    const fix = buildFixture([]);
    expect(createUnusedDepsRule('error')(ctx(fix))).toEqual([]);
    expect(createUnusedDevDepsRule('error')(ctx(fix))).toEqual([]);
    expect(createUnusedOptionalDepsRule('error')(ctx(fix))).toEqual([]);
  });

  it('malformed JSON → all three rules emit nothing', () => {
    writeFileSync(join(projectRoot, 'package.json'), '{not-json', 'utf8');
    const fix = buildFixture([]);
    expect(createUnusedDepsRule('error')(ctx(fix))).toEqual([]);
  });

  it('verbatim message format (deps)', () => {
    writeManifest({ dependencies: { lodash: '^4' } });
    const fix = buildFixture([]);
    const findings = createUnusedDepsRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe('unused-deps: package lodash declared but not imported');
  });

  it('verbatim message format (dev-deps)', () => {
    writeManifest({ devDependencies: { eslint: '^9' } });
    const fix = buildFixture([]);
    const findings = createUnusedDevDepsRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe('unused-dev-deps: package eslint declared but not imported');
  });

  it('verbatim message format (optional-deps)', () => {
    writeManifest({ optionalDependencies: { fsevents: '^2' } });
    const fix = buildFixture([]);
    const findings = createUnusedOptionalDepsRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe(
      'unused-optional-deps: package fsevents declared but not imported',
    );
  });

  it('relative imports do not count as bare specifiers', () => {
    writeManifest({ dependencies: { react: '^18' } });
    const fix = buildFixture([{ path: '/proj/a.ts', bareImports: ['./b', '../c'] }]);
    const findings = createUnusedDepsRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    expect(findings[0]?.kind === 'unused-deps' && findings[0].dependency).toBe('react');
  });

  it('node: scheme imports are ignored', () => {
    writeManifest({ dependencies: { fs: '^0.0.0' } });
    const fix = buildFixture([{ path: '/proj/a.ts', bareImports: ['node:fs'] }]);
    const findings = createUnusedDepsRule('error')(ctx(fix));
    expect(findings.length).toBe(1); // 'fs' still flagged — node:fs is not bare-pkg
  });

  it('determinism: outputs are sorted ascending and stable across runs', () => {
    writeManifest({ dependencies: { z: '^1', a: '^1', m: '^1' } });
    const fix = buildFixture([]);
    const c = ctx(fix);
    const r1 = createUnusedDepsRule('error')(c);
    __clearUnusedDepsCacheForTest(c);
    const r2 = createUnusedDepsRule('error')(c);
    expect(r1.map((i) => (i.kind === 'unused-deps' ? i.dependency : ''))).toEqual(['a', 'm', 'z']);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
