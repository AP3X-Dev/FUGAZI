/**
 * unused-members-py.test.ts — Phase 4c T333 acceptance suite.
 *
 * Python class members are framework-presumed-used when:
 *   - The member name matches the dunder lifecycle allowlist
 *     (`__init__`, `__str__`, etc.).
 *   - The member is decorated (visitor surfaces decorated method names
 *     via `decoratedMembers`).
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Declaration, Inventory, Usage } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import type { RuleContext } from '../types.js';
import { createUnusedClassMembersRule } from '../unused-members.js';

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

function pyClassDecl(
  name: string,
  members: readonly string[],
  decoratedMembers?: readonly string[],
): Declaration {
  return {
    kind: 'class',
    name,
    exported: true,
    range: range(0),
    members,
    ...(decoratedMembers !== undefined ? { decoratedMembers } : {}),
  };
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
      lang: 'py',
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

describe('unused-class-members — Python (T333)', () => {
  it('__init__ is NOT flagged (dunder lifecycle method)', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Service', ['__init__', 'helper'])],
      },
    ]);
    const findings = createUnusedClassMembersRule('error')(ctx(fix));
    // helper is not exempt and not used → flagged. __init__ is exempt.
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unused-class-members') throw new Error('expected');
    expect(f.memberName).toBe('helper');
  });

  it('__str__ is NOT flagged (dunder)', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Service', ['__str__'])],
      },
    ]);
    expect(createUnusedClassMembersRule('error')(ctx(fix))).toEqual([]);
  });

  it('regular method `helper()` IS flagged when unused', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Service', ['helper'])],
      },
    ]);
    const findings = createUnusedClassMembersRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unused-class-members') throw new Error('expected');
    expect(f.memberName).toBe('helper');
    expect(f.className).toBe('Service');
  });

  it('@decorated method (e.g. @app.route) is NOT flagged', () => {
    const fix = buildFixture([
      {
        path: '/proj/views.py',
        declarations: [
          pyClassDecl('UserView', ['list_users', 'create_user'], ['list_users', 'create_user']),
        ],
      },
    ]);
    expect(createUnusedClassMembersRule('error')(ctx(fix))).toEqual([]);
  });

  it('@property decorated method is NOT flagged', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Service', ['name'], ['name'])],
      },
    ]);
    expect(createUnusedClassMembersRule('error')(ctx(fix))).toEqual([]);
  });

  it('ordinarily used method (referenced from another file) NOT flagged', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Service', ['process'])],
      },
      {
        path: '/proj/main.py',
        importsTo: ['/proj/models.py'],
        usages: [usage('process')],
      },
    ]);
    expect(createUnusedClassMembersRule('error')(ctx(fix))).toEqual([]);
  });

  it('many dunders + one undecorated unused method → only the bare method flagged', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [
          pyClassDecl('Container', [
            '__init__',
            '__len__',
            '__iter__',
            '__contains__',
            '__enter__',
            '__exit__',
            'unused_helper',
          ]),
        ],
      },
    ]);
    const findings = createUnusedClassMembersRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unused-class-members') throw new Error('expected');
    expect(f.memberName).toBe('unused_helper');
  });

  it('decorated dunder is also exempt (belt-and-suspenders)', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Service', ['__init__'], ['__init__'])],
      },
    ]);
    expect(createUnusedClassMembersRule('error')(ctx(fix))).toEqual([]);
  });

  it('__eq__ / __hash__ / __ne__ comparison dunders are NOT flagged', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Value', ['__eq__', '__hash__', '__ne__'])],
      },
    ]);
    expect(createUnusedClassMembersRule('error')(ctx(fix))).toEqual([]);
  });

  it('arithmetic dunders (__add__, __radd__, __iadd__) are NOT flagged', () => {
    const fix = buildFixture([
      {
        path: '/proj/numbers.py',
        declarations: [pyClassDecl('N', ['__add__', '__radd__', '__iadd__'])],
      },
    ]);
    expect(createUnusedClassMembersRule('error')(ctx(fix))).toEqual([]);
  });

  it('verbatim message format matches TS', () => {
    const fix = buildFixture([
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Service', ['helper'])],
      },
    ]);
    const findings = createUnusedClassMembersRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe(
      'unused-class-members: Service.helper in /proj/models.py has no consumers',
    );
  });
});
