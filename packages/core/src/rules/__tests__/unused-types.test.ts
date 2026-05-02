/**
 * unused-types.test.ts — Phase 3f.2 Wave 1 (T140) acceptance suite.
 *
 * In-memory fixtures only. Same per-file consumer fallback as
 * unused-exports — file with at least one incoming edge → no flags;
 * unconsumed file with `kind: 'type'` declarations → flag each one.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Declaration, Inventory } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import type { RuleContext } from '../types.js';
import { createUnusedTypesRule } from '../unused-types.js';

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

describe('createUnusedTypesRule', () => {
  it('(a) export type Foo in unconsumed file → flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'type', true, 0)],
      },
    ]);
    const rule = createUnusedTypesRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'unused-types') {
      throw new Error('unexpected');
    }
    expect(finding.typeName).toBe('Foo');
    expect(finding.file).toBe('/proj/a.ts');
  });

  it('(b) export interface Bar in consumed file → not flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts', importsTo: [{ path: '/proj/a.ts' }] },
      {
        path: '/proj/a.ts',
        declarations: [decl('Bar', 'type', true, 0)],
      },
    ]);
    const rule = createUnusedTypesRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('(c) verbatim error string', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'type', true, 0)],
      },
    ]);
    const rule = createUnusedTypesRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings[0]?.message).toBe('unused-types: Foo in /proj/a.ts has no consumers');
  });

  it('(d) mixed file: type + non-type, no consumers → only type flagged here', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'type', true, 0), decl('runtime', 'function', true, 50)],
      },
    ]);
    const rule = createUnusedTypesRule('error');
    const findings = rule(ctx(fix, ['/proj/entry.ts']));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'unused-types') {
      throw new Error('unexpected');
    }
    expect(finding.typeName).toBe('Foo');
  });

  it('skips non-exported type declarations', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('Hidden', 'type', false, 0)],
      },
    ]);
    const rule = createUnusedTypesRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('skips entry-point files', () => {
    const fix = buildFixture([
      {
        path: '/proj/entry.ts',
        declarations: [decl('PublicAPI', 'type', true, 0)],
      },
    ]);
    const rule = createUnusedTypesRule('error');
    expect(rule(ctx(fix, ['/proj/entry.ts']))).toEqual([]);
  });

  it('empty entryPoints → no findings', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'type', true, 0)],
      },
    ]);
    const rule = createUnusedTypesRule('error');
    expect(rule(ctx(fix, []))).toEqual([]);
  });
});
