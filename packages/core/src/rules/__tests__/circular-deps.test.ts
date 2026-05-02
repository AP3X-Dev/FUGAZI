/**
 * circular-deps.test.ts — Phase 3f.2 Wave 2 (T146) acceptance suite.
 *
 * In-memory fixtures only. Each fixture builds a synthetic Graph with the
 * path-sorted FileId mapping, then asserts the iterative-Tarjan SCC detector
 * + canonical-walk emit the expected cycle list.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { createCircularDependenciesRule } from '../circular-deps.js';
import type { RuleContext } from '../types.js';

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

interface FileSpec {
  readonly path: string;
  readonly importsTo?: readonly string[];
}

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
    for (const target of spec.importsTo ?? []) {
      const toId = ids.get(target);
      if (toId === undefined) {
        edges.push({
          from: fromId,
          to: ROOT_FILE_ID,
          kind: 'static',
          specifier: target,
          resolvable: false,
          loc: ZERO_RANGE,
        });
      } else {
        edges.push({
          from: fromId,
          to: toId,
          kind: 'static',
          specifier: target,
          resolvable: true,
          loc: ZERO_RANGE,
        });
      }
    }
  }
  edges.sort((a, b) => {
    if (a.from !== b.from) return (a.from as number) - (b.from as number);
    if (a.to !== b.to) return (a.to as number) - (b.to as number);
    return a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0;
  });
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

function ctx(fixture: ReturnType<typeof buildFixture>): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot: '/proj',
    entryPoints: [],
    config: emptyConfig(),
  };
}

describe('createCircularDependenciesRule', () => {
  it('(a) two-file cycle a → b → a → emits one cycle', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts', importsTo: ['/proj/a.ts'] },
    ]);
    const rule = createCircularDependenciesRule('error');
    const findings = rule(ctx(fix));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'circular-dependencies') {
      throw new Error('unexpected');
    }
    expect(finding.cycle).toEqual(['/proj/a.ts', '/proj/b.ts', '/proj/a.ts']);
    expect(finding.file).toBe('/proj/a.ts');
  });

  it('(b) acyclic graph emits nothing', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts', importsTo: ['/proj/c.ts'] },
      { path: '/proj/c.ts' },
    ]);
    const rule = createCircularDependenciesRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('(c) three-file cycle a → b → c → a', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts', importsTo: ['/proj/c.ts'] },
      { path: '/proj/c.ts', importsTo: ['/proj/a.ts'] },
    ]);
    const rule = createCircularDependenciesRule('error');
    const findings = rule(ctx(fix));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'circular-dependencies') {
      throw new Error('unexpected');
    }
    expect(finding.cycle).toEqual(['/proj/a.ts', '/proj/b.ts', '/proj/c.ts', '/proj/a.ts']);
  });

  it('(d) self-loop on x → emits cycle [x, x]', () => {
    const fix = buildFixture([{ path: '/proj/x.ts', importsTo: ['/proj/x.ts'] }]);
    const rule = createCircularDependenciesRule('error');
    const findings = rule(ctx(fix));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'circular-dependencies') {
      throw new Error('unexpected');
    }
    expect(finding.cycle).toEqual(['/proj/x.ts', '/proj/x.ts']);
  });

  it('(e) two disjoint cycles → both reported, sorted by file', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts', importsTo: ['/proj/a.ts'] },
      { path: '/proj/x.ts', importsTo: ['/proj/y.ts'] },
      { path: '/proj/y.ts', importsTo: ['/proj/x.ts'] },
    ]);
    const rule = createCircularDependenciesRule('error');
    const findings = rule(ctx(fix));
    expect(findings.map((f) => f.file)).toEqual(['/proj/a.ts', '/proj/x.ts']);
  });

  it('verbatim message format', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts', importsTo: ['/proj/a.ts'] },
    ]);
    const rule = createCircularDependenciesRule('error');
    const findings = rule(ctx(fix));
    expect(findings[0]?.message).toBe(
      'circular-dependencies: cycle detected: /proj/a.ts → /proj/b.ts → /proj/a.ts',
    );
  });

  it('determinism: same fixture run twice → byte-equal output', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts', importsTo: ['/proj/c.ts'] },
      { path: '/proj/c.ts', importsTo: ['/proj/a.ts'] },
    ]);
    const rule = createCircularDependenciesRule('error');
    const r1 = JSON.stringify(rule(ctx(fix)));
    const r2 = JSON.stringify(rule(ctx(fix)));
    expect(r1).toBe(r2);
  });

  it('skips edges with to === ROOT_FILE_ID (external/unresolved)', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['react'] }, // unresolved → ROOT
    ]);
    const rule = createCircularDependenciesRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });
});
