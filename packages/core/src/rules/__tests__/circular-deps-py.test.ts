/**
 * circular-deps-py.test.ts — Phase 4c T334 acceptance suite.
 *
 * Verifies that the existing iterative-Tarjan SCC detector + canonical-walk
 * works on a Python module graph. No code changes were expected for this
 * task — the rule is fully language-agnostic. These tests confirm.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Inventory } from '@fugazi/extract';
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

function buildPyFixture(specs: readonly FileSpec[]): {
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
    const node: FileNode = { id, path: spec.path, inventory };
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

function ctx(fixture: ReturnType<typeof buildPyFixture>): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot: '/proj',
    entryPoints: [],
    config: emptyConfig(),
  };
}

describe('circular-dependencies — Python (T334)', () => {
  it('three-module Python cycle a → b → c → a is detected with deterministic order', () => {
    const fix = buildPyFixture([
      { path: '/proj/a.py', importsTo: ['/proj/b.py'] },
      { path: '/proj/b.py', importsTo: ['/proj/c.py'] },
      { path: '/proj/c.py', importsTo: ['/proj/a.py'] },
    ]);
    const findings = createCircularDependenciesRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'circular-dependencies') throw new Error('expected');
    expect(f.cycle).toEqual(['/proj/a.py', '/proj/b.py', '/proj/c.py', '/proj/a.py']);
    expect(f.file).toBe('/proj/a.py');
  });

  it('non-cyclic Python graph reports zero cycles', () => {
    const fix = buildPyFixture([
      { path: '/proj/a.py', importsTo: ['/proj/b.py'] },
      { path: '/proj/b.py', importsTo: ['/proj/c.py'] },
      { path: '/proj/c.py' },
    ]);
    expect(createCircularDependenciesRule('error')(ctx(fix))).toEqual([]);
  });

  it('two-file Python cycle a ↔ b is detected', () => {
    const fix = buildPyFixture([
      { path: '/proj/foo.py', importsTo: ['/proj/bar.py'] },
      { path: '/proj/bar.py', importsTo: ['/proj/foo.py'] },
    ]);
    const findings = createCircularDependenciesRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'circular-dependencies') throw new Error('expected');
    expect(f.cycle).toEqual(['/proj/bar.py', '/proj/foo.py', '/proj/bar.py']);
  });
});
