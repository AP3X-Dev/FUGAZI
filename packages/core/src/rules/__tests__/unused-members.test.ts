/**
 * unused-members.test.ts — Phase 3f.2 Wave 2 (T144) acceptance suite.
 *
 * In-memory fixtures only. Asserts the per-class / per-enum member walker
 * emits one finding per unused member, skipping members whose name appears
 * as an `identifier`/`member` Usage in any file that imports the parent.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Declaration, Inventory, Usage } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import type { RuleContext } from '../types.js';
import { createUnusedClassMembersRule, createUnusedEnumMembersRule } from '../unused-members.js';

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

function range(off: number): Range {
  return {
    start: { line: 1, column: 0, byteOffset: off },
    end: { line: 1, column: 1, byteOffset: off + 1 },
  };
}

function decl(
  name: string,
  kind: Declaration['kind'],
  exported: boolean,
  members: readonly string[] = [],
): Declaration {
  return { kind, name, exported, range: range(0), members };
}

function usage(name: string, kind: Usage['kind'] = 'identifier'): Usage {
  return { kind, name, range: range(0) };
}

interface FileSpec {
  readonly path: string;
  readonly declarations?: readonly Declaration[];
  readonly usages?: readonly Usage[];
  readonly importsTo?: readonly string[];
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
      usages: Object.freeze([...(spec.usages ?? [])]),
    });
    fileNodes.set(spec.path, { id, path: spec.path, inventory });
    filesById.set(id, { id, path: spec.path, inventory });
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
          loc: range(0),
        });
      } else {
        edges.push({
          from: fromId,
          to: toId,
          kind: 'static',
          specifier: target,
          resolvable: true,
          loc: range(0),
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

function ctx(fixture: ReturnType<typeof buildFixture>): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot: '/proj',
    entryPoints: [],
    config: emptyConfig(),
  };
}

describe('createUnusedEnumMembersRule', () => {
  it('(a) enum with one used + one unused member → one finding', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('Color', 'enum', true, ['Red', 'Blue'])],
      },
      {
        path: '/proj/uses.ts',
        importsTo: ['/proj/a.ts'],
        usages: [usage('Red')],
      },
    ]);
    const rule = createUnusedEnumMembersRule('error');
    const findings = rule(ctx(fix));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'unused-enum-members') {
      throw new Error('unexpected');
    }
    expect(finding.enumName).toBe('Color');
    expect(finding.memberName).toBe('Blue');
  });

  it('(b) enum with all members used → no findings', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', declarations: [decl('E', 'enum', true, ['A', 'B'])] },
      {
        path: '/proj/uses.ts',
        importsTo: ['/proj/a.ts'],
        usages: [usage('A'), usage('B')],
      },
    ]);
    const rule = createUnusedEnumMembersRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('(c) qualified usage E.M counts as used', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', declarations: [decl('E', 'enum', true, ['A'])] },
      {
        path: '/proj/uses.ts',
        importsTo: ['/proj/a.ts'],
        usages: [usage('E.A', 'member')],
      },
    ]);
    const rule = createUnusedEnumMembersRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('(d) non-exported enum is skipped', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', declarations: [decl('Internal', 'enum', false, ['X'])] },
    ]);
    const rule = createUnusedEnumMembersRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('verbatim message format', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', declarations: [decl('Color', 'enum', true, ['Blue'])] },
    ]);
    const rule = createUnusedEnumMembersRule('error');
    const findings = rule(ctx(fix));
    expect(findings[0]?.message).toBe(
      'unused-enum-members: Color.Blue in /proj/a.ts has no consumers',
    );
  });
});

describe('createUnusedClassMembersRule', () => {
  it('(a) class with one used + one unused method → one finding', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'class', true, ['used', 'dead'])],
      },
      {
        path: '/proj/uses.ts',
        importsTo: ['/proj/a.ts'],
        usages: [usage('used', 'member')],
      },
    ]);
    const rule = createUnusedClassMembersRule('error');
    const findings = rule(ctx(fix));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'unused-class-members') {
      throw new Error('unexpected');
    }
    expect(finding.className).toBe('Foo');
    expect(finding.memberName).toBe('dead');
  });

  it('(b) self-reference within parent file counts as usage', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'class', true, ['internal'])],
        usages: [usage('internal', 'member')],
      },
    ]);
    const rule = createUnusedClassMembersRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('(c) verbatim message format', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', declarations: [decl('Foo', 'class', true, ['dead'])] },
    ]);
    const rule = createUnusedClassMembersRule('error');
    const findings = rule(ctx(fix));
    expect(findings[0]?.message).toBe(
      'unused-class-members: Foo.dead in /proj/a.ts has no consumers',
    );
  });

  it('determinism: same fixture twice → byte-equal output', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'class', true, ['a', 'b', 'c'])],
      },
    ]);
    const rule = createUnusedClassMembersRule('error');
    const r1 = JSON.stringify(rule(ctx(fix)));
    const r2 = JSON.stringify(rule(ctx(fix)));
    expect(r1).toBe(r2);
  });

  it('empty members array is skipped', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', declarations: [decl('Bare', 'class', true, [])] },
    ]);
    const rule = createUnusedClassMembersRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });
});
