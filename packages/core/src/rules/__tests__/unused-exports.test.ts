/**
 * unused-exports.test.ts — Phase 3f.2 Wave 1 (T138) acceptance suite.
 *
 * In-memory fixtures only. Verifies the per-file consumer-fallback behaviour
 * documented in the rule header: files with at least one incoming edge are
 * skipped, files with zero incoming edges and not declared as entry points
 * have every non-type export flagged.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Declaration, Inventory } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import type { RuleContext } from '../types.js';
import { createUnusedExportsRule } from '../unused-exports.js';

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

interface FileSpec {
  readonly path: string;
  readonly declarations?: readonly Declaration[];
  readonly importsTo?: readonly { path: string }[];
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

function decl(
  name: string,
  kind: Declaration['kind'],
  exported: boolean,
  byteOffset = 0,
): Declaration {
  return {
    kind,
    name,
    exported,
    range: {
      start: { line: 1, column: 0, byteOffset },
      end: { line: 1, column: 1, byteOffset: byteOffset + 1 },
    },
    members: [],
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
    const inventory: Inventory = Object.freeze({
      declarations: Object.freeze([...(spec.declarations ?? [])]),
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
    for (const imp of spec.importsTo ?? []) {
      const toId = ids.get(imp.path);
      if (toId === undefined) {
        edges.push({
          from: fromId,
          to: ROOT_FILE_ID,
          kind: 'static',
          specifier: imp.path,
          resolvable: false,
          loc: ZERO_RANGE,
        });
      } else {
        edges.push({
          from: fromId,
          to: toId,
          kind: 'static',
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
    return 0;
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

describe('createUnusedExportsRule', () => {
  it('(a) file with no consumers and not entry → every non-type export flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('foo', 'function', true, 0), decl('bar', 'function', true, 50)],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    const names = findings.map((f) => (f.kind === 'unused-exports' ? f.exportName : null));
    expect(names).toEqual(['foo', 'bar']);
  });

  it('(b) a.ts exported foo, entry imports a → no findings', () => {
    const fix = buildFixture([
      {
        path: '/proj/entry.ts',
        importsTo: [{ path: '/proj/a.ts' }],
      },
      {
        path: '/proj/a.ts',
        declarations: [decl('foo', 'function', true, 0)],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('(c) re-export through barrel → e has consumers (barrel imports it), no findings on e', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts', importsTo: [{ path: '/proj/barrel.ts' }] },
      { path: '/proj/barrel.ts', importsTo: [{ path: '/proj/e.ts' }] },
      {
        path: '/proj/e.ts',
        declarations: [decl('thing', 'function', true, 0)],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('(d) side-effect import of ./side from entry → side has consumers, no findings', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts', importsTo: [{ path: '/proj/side.ts' }] },
      {
        path: '/proj/side.ts',
        declarations: [decl('alpha', 'function', true, 0)],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('(e) verbatim error string', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('foo', 'function', true, 0)],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings[0]?.message).toBe('unused-exports: foo in /proj/a.ts has no consumers');
  });

  it('skips entry-point files entirely', () => {
    const fix = buildFixture([
      {
        path: '/proj/entry.ts',
        declarations: [decl('boot', 'function', true, 0)],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('skips kind:type and kind:css-class declarations', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [
          decl('Foo', 'type', true, 0),
          decl('css-x', 'css-class', true, 50),
          decl('runtime', 'function', true, 100),
        ],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'unused-exports') {
      throw new Error('unexpected');
    }
    expect(finding.exportName).toBe('runtime');
  });

  it('skips non-exported declarations', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('hidden', 'function', false, 0), decl('exposed', 'function', true, 50)],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings.length).toBe(1);
  });

  it('empty entryPoints → no findings', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('foo', 'function', true, 0)],
      },
    ]);
    const rule = createUnusedExportsRule('error');
    expect(rule(ctx(fix, []))).toEqual([]);
  });
});
