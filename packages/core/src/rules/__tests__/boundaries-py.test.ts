/**
 * boundaries-py.test.ts — Phase 4c T337 acceptance suite.
 *
 * Verifies the boundary-violations rule treats Python file imports the
 * same as TS — zone classification works on file paths regardless of
 * source language.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Inventory } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { createBoundaryViolationsRule } from '../boundaries.js';
import type { RuleContext } from '../types.js';

const PROJECT_ROOT = '/proj';
const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

interface FileSpec {
  readonly path: string;
  readonly importsTo?: readonly string[];
}

type Zones = NonNullable<FugaziConfig['zones']>;

function makeConfig(zones?: Zones): FugaziConfig {
  const base: FugaziConfig = {
    rules: {},
    include: [],
    exclude: [],
    production: false,
    strict: false,
    experimentalTsPlugins: false,
  };
  if (zones === undefined) return base;
  return { ...base, zones };
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

function ctx(fixture: ReturnType<typeof buildPyFixture>, zones?: Zones): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot: PROJECT_ROOT,
    entryPoints: [],
    config: makeConfig(zones),
  };
}

describe('boundary-violations — Python (T337)', () => {
  it('Python file in zone A imports zone B (violation)', () => {
    const fix = buildPyFixture([
      { path: '/proj/a/main.py', importsTo: ['/proj/b/internal.py'] },
      { path: '/proj/b/internal.py' },
    ]);
    const findings = createBoundaryViolationsRule('error')(
      ctx(fix, {
        a: { pattern: ['a/**'], canImport: [] },
        b: { pattern: ['b/**'], canImport: [] },
      }),
    );
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'boundary-violations') throw new Error('expected');
    expect(f.fromZone).toBe('a');
    expect(f.toZone).toBe('b');
  });

  it('Python file imports allowed zone (no violation)', () => {
    const fix = buildPyFixture([
      { path: '/proj/a/main.py', importsTo: ['/proj/b/api.py'] },
      { path: '/proj/b/api.py' },
    ]);
    const findings = createBoundaryViolationsRule('error')(
      ctx(fix, {
        a: { pattern: ['a/**'], canImport: ['b'] },
        b: { pattern: ['b/**'], canImport: [] },
      }),
    );
    expect(findings).toEqual([]);
  });
});
