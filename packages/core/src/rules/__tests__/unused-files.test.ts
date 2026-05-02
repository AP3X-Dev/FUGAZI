/**
 * unused-files.test.ts — Phase 3f.2 Wave 1 (T136) acceptance suite.
 *
 * In-memory fixtures only — no disk I/O, no parser/visitor invocation. Each
 * fixture builds a synthetic Graph (FileNode + Edge literals) using the
 * path-sorted FileId mapping from `assignFileIds`, then asserts the rule's
 * BFS reachability behaviour against it.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import type { RuleContext } from '../types.js';
import { createUnusedFilesRule } from '../unused-files.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

interface FileSpec {
  readonly path: string;
  readonly importsTo?: readonly { path: string; kind?: Edge['kind'] }[];
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

function emptyInventory() {
  return Object.freeze({
    declarations: Object.freeze([]),
    imports: Object.freeze([]),
    usages: Object.freeze([]),
  });
}

function buildFixture(specs: readonly FileSpec[]): {
  graph: Graph;
  fileNodes: ReadonlyMap<string, FileNode>;
  idOf: (path: string) => FileId;
} {
  const sorted = [...specs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const ids = assignFileIds(sorted.map((s) => s.path));
  const fileNodes = new Map<string, FileNode>();
  const filesById = new Map<FileId, FileNode>();
  for (const spec of sorted) {
    const id = ids.get(spec.path);
    if (id === undefined) throw new Error(`no id for ${spec.path}`);
    const node: FileNode = { id, path: spec.path, inventory: emptyInventory() };
    fileNodes.set(spec.path, node);
    filesById.set(id, node);
  }
  const edges: Edge[] = [];
  for (const spec of sorted) {
    const fromId = ids.get(spec.path);
    if (fromId === undefined) continue;
    for (const imp of spec.importsTo ?? []) {
      const toId = ids.get(imp.path);
      const kind = imp.kind ?? 'static';
      if (toId === undefined) {
        edges.push({
          from: fromId,
          to: ROOT_FILE_ID,
          kind,
          specifier: imp.path,
          resolvable: false,
          loc: ZERO_RANGE,
        });
      } else {
        edges.push({
          from: fromId,
          to: toId,
          kind,
          specifier: imp.path,
          resolvable: true,
          loc: ZERO_RANGE,
        });
      }
    }
  }
  edges.sort((a, b) => {
    if (a.from !== b.from) return (a.from as number) - (b.from as number);
    if (a.to !== b.to) return (a.to as number) - (b.to as number);
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
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
  const graph: Graph = Object.freeze({
    files: filesById,
    edges,
    edgesByTarget,
  });
  return {
    graph,
    fileNodes,
    idOf: (path: string) => {
      const id = ids.get(path);
      if (id === undefined) throw new Error(`no id for ${path}`);
      return id;
    },
  };
}

function ctx(
  fixture: ReturnType<typeof buildFixture>,
  entryPoints: readonly string[],
): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot: '/proj',
    entryPoints,
    config: emptyConfig(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('createUnusedFilesRule', () => {
  it('(a) entry → a → b, c orphan → c is flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts', importsTo: [{ path: '/proj/a.ts' }] },
      { path: '/proj/a.ts', importsTo: [{ path: '/proj/b.ts' }] },
      { path: '/proj/b.ts' },
      { path: '/proj/c.ts' },
    ]);
    const rule = createUnusedFilesRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings.map((f) => f.file)).toEqual(['/proj/c.ts']);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'unused-files') throw new Error('unexpected');
    expect(finding.path).toBe('/proj/c.ts');
    expect(finding.severity).toBe('error');
    expect(finding.range).toBeUndefined();
  });

  it('(b) entry → dynamic → d → reachable, no findings', () => {
    const fix = buildFixture([
      {
        path: '/proj/entry.ts',
        importsTo: [{ path: '/proj/d.ts', kind: 'dynamic' }],
      },
      { path: '/proj/d.ts' },
    ]);
    const rule = createUnusedFilesRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings).toEqual([]);
  });

  it('(c) 5-level chain entry → a → b → c → d → e all reachable', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts', importsTo: [{ path: '/proj/a.ts' }] },
      { path: '/proj/a.ts', importsTo: [{ path: '/proj/b.ts' }] },
      { path: '/proj/b.ts', importsTo: [{ path: '/proj/c.ts' }] },
      { path: '/proj/c.ts', importsTo: [{ path: '/proj/d.ts' }] },
      { path: '/proj/d.ts', importsTo: [{ path: '/proj/e.ts' }] },
      { path: '/proj/e.ts' },
    ]);
    const rule = createUnusedFilesRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('(d) entry → barrel re-exports e → both reachable', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts', importsTo: [{ path: '/proj/barrel.ts' }] },
      { path: '/proj/barrel.ts', importsTo: [{ path: '/proj/e.ts' }] },
      { path: '/proj/e.ts' },
    ]);
    const rule = createUnusedFilesRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('(e) two entry points: file f reachable only from entry2 → no findings', () => {
    const fix = buildFixture([
      { path: '/proj/entry1.ts', importsTo: [{ path: '/proj/a.ts' }] },
      { path: '/proj/entry2.ts', importsTo: [{ path: '/proj/f.ts' }] },
      { path: '/proj/a.ts' },
      { path: '/proj/f.ts' },
    ]);
    const rule = createUnusedFilesRule('error');
    expect(rule(ctx(fix, ['/proj/entry1.ts', '/proj/entry2.ts']))).toEqual([]);
  });

  it('empty entryPoints → no findings even when files exist', () => {
    const fix = buildFixture([{ path: '/proj/a.ts' }, { path: '/proj/b.ts' }]);
    const rule = createUnusedFilesRule('error');
    expect(rule(ctx(fix, []))).toEqual([]);
  });

  it('multiple orphans emit path-sorted output', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      { path: '/proj/zeta.ts' },
      { path: '/proj/alpha.ts' },
      { path: '/proj/beta.ts' },
    ]);
    const rule = createUnusedFilesRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings.map((f) => f.file)).toEqual([
      '/proj/alpha.ts',
      '/proj/beta.ts',
      '/proj/zeta.ts',
    ]);
  });

  it('verbatim message format', () => {
    const fix = buildFixture([{ path: '/proj/entry.ts' }, { path: '/proj/orphan.ts' }]);
    const rule = createUnusedFilesRule('warn');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings[0]?.message).toBe(
      'unused-files: /proj/orphan.ts is not reachable from any entry point',
    );
    expect(findings[0]?.severity).toBe('warn');
  });
});
