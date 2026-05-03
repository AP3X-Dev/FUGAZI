/**
 * unused-types-py.test.ts — Phase 4c T331 acceptance suite.
 *
 * Per-file Python type-export reachability. Detects:
 *   - `class-decl` with bases including `TypedDict` / `Protocol`.
 *   - `variable-decl` with `annotation === 'TypeAlias'`.
 *   - `variable-decl` with `valueCallee === 'NewType'` / `'TypeAliasType'`
 *     / `'TypeVar'` / `'ParamSpec'`.
 *
 * Excludes:
 *   - Plain `class-decl` with no type-marker bases (regular Python class).
 *   - `class-decl` with bases like `Generic[T]` (subclass of Generic, not
 *     a type alias — Generic is a runtime parameterised class).
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

function range(off: number): Range {
  return {
    start: { line: 1, column: 0, byteOffset: off },
    end: { line: 1, column: 1, byteOffset: off + 1 },
  };
}

function pyClassDecl(
  name: string,
  bases: readonly string[],
  exported = true,
  byteOffset = 0,
): Declaration {
  return {
    kind: 'class',
    name,
    exported,
    range: range(byteOffset),
    members: [],
    bases,
  };
}

function pyVariableDecl(
  name: string,
  options: {
    readonly annotation?: string;
    readonly valueCallee?: string;
    readonly exported?: boolean;
    readonly byteOffset?: number;
  },
): Declaration {
  return {
    kind: 'variable',
    name,
    exported: options.exported ?? true,
    range: range(options.byteOffset ?? 0),
    members: [],
    ...(options.annotation !== undefined ? { annotation: options.annotation } : {}),
    ...(options.valueCallee !== undefined ? { valueCallee: options.valueCallee } : {}),
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
      lang: 'py',
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

describe('unused-types — Python (T331)', () => {
  it('TypedDict in unconsumed file → flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/types.py',
        declarations: [pyClassDecl('UserDict', ['TypedDict'])],
      },
    ]);
    const findings = createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unused-types') throw new Error('expected unused-types');
    expect(f.typeName).toBe('UserDict');
    expect(f.file).toBe('/proj/types.py');
  });

  it('TypedDict in consumed file → NOT flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py', importsTo: [{ path: '/proj/types.py' }] },
      {
        path: '/proj/types.py',
        declarations: [pyClassDecl('UserDict', ['TypedDict'])],
      },
    ]);
    expect(createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']))).toEqual([]);
  });

  it('Protocol in unconsumed file → flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/types.py',
        declarations: [pyClassDecl('Comparable', ['Protocol'])],
      },
    ]);
    const findings = createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unused-types') throw new Error('expected unused-types');
    expect(f.typeName).toBe('Comparable');
  });

  it('Protocol in consumed file → NOT flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py', importsTo: [{ path: '/proj/types.py' }] },
      {
        path: '/proj/types.py',
        declarations: [pyClassDecl('Comparable', ['Protocol'])],
      },
    ]);
    expect(createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']))).toEqual([]);
  });

  it('TypeAlias in unconsumed file → flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/types.py',
        declarations: [pyVariableDecl('UserId', { annotation: 'TypeAlias' })],
      },
    ]);
    const findings = createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unused-types') throw new Error('expected unused-types');
    expect(f.typeName).toBe('UserId');
  });

  it('TypeAlias in consumed file → NOT flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py', importsTo: [{ path: '/proj/types.py' }] },
      {
        path: '/proj/types.py',
        declarations: [pyVariableDecl('UserId', { annotation: 'TypeAlias' })],
      },
    ]);
    expect(createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']))).toEqual([]);
  });

  it('NewType in unconsumed file → flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/types.py',
        declarations: [pyVariableDecl('UserId', { valueCallee: 'NewType' })],
      },
    ]);
    const findings = createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unused-types') throw new Error('expected unused-types');
    expect(f.typeName).toBe('UserId');
  });

  it('NewType in consumed file → NOT flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py', importsTo: [{ path: '/proj/types.py' }] },
      {
        path: '/proj/types.py',
        declarations: [pyVariableDecl('UserId', { valueCallee: 'NewType' })],
      },
    ]);
    expect(createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']))).toEqual([]);
  });

  it('regular Python class (no type-marker bases) → NOT flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/models.py',
        declarations: [pyClassDecl('Service', ['object'])],
      },
    ]);
    expect(createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']))).toEqual([]);
  });

  it('Generic[T] subclass → NOT flagged (Generic is not a type marker)', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/types.py',
        // The visitor surfaces `Generic` (subscript receiver) as a base.
        // The rule excludes it because Generic is a runtime class.
        declarations: [pyClassDecl('Container', ['Generic'])],
      },
    ]);
    expect(createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']))).toEqual([]);
  });

  it('TypeVar in unconsumed file → flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/types.py',
        declarations: [pyVariableDecl('T', { valueCallee: 'TypeVar' })],
      },
    ]);
    const findings = createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']));
    expect(findings.length).toBe(1);
  });

  it('verbatim message format is identical to TS', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/types.py',
        declarations: [pyClassDecl('UserDict', ['TypedDict'])],
      },
    ]);
    const findings = createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']));
    expect(findings[0]?.message).toBe('unused-types: UserDict in /proj/types.py has no consumers');
  });

  it('non-exported type-like declaration → NOT flagged', () => {
    const fix = buildFixture([
      { path: '/proj/entry.py' },
      {
        path: '/proj/types.py',
        declarations: [pyClassDecl('_PrivateDict', ['TypedDict'], false)],
      },
    ]);
    expect(createUnusedTypesRule('error')(ctx(fix, ['/proj/entry.py']))).toEqual([]);
  });
});
