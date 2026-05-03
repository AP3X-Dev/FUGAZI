/**
 * private-type-leak-py.test.ts — Phase 4c T338 acceptance suite.
 *
 * Python doesn't have an enforced public/private type distinction (leading
 * underscore is convention, not language-level). The rule emits zero
 * issues on `.py` files for v1; mixed projects flag only TS leaks.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Declaration, Inventory, Usage } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { createPrivateTypeLeakRule } from '../private-type-leak.js';
import type { RuleContext } from '../types.js';

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

function range(off: number, length = 1): Range {
  return {
    start: { line: 1, column: 0, byteOffset: off },
    end: { line: 1, column: length, byteOffset: off + length },
  };
}

function decl(
  name: string,
  kind: Declaration['kind'],
  exported: boolean,
  byteOffset: number,
  byteLength = 100,
): Declaration {
  return {
    kind,
    name,
    exported,
    range: range(byteOffset, byteLength),
    members: [],
  };
}

function usage(name: string, byteOffset: number, kind: Usage['kind'] = 'identifier'): Usage {
  return { kind, name, range: range(byteOffset, name.length) };
}

interface FileSpec {
  readonly path: string;
  readonly lang?: 'ts' | 'py';
  readonly declarations?: readonly Declaration[];
  readonly usages?: readonly Usage[];
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
    const inventoryBase = {
      declarations: Object.freeze([...(spec.declarations ?? [])]),
      imports: Object.freeze([] as Edge[]),
      usages: Object.freeze([...(spec.usages ?? [])]),
    };
    const inventory: Inventory =
      spec.lang === 'py'
        ? Object.freeze({ lang: 'py' as const, ...inventoryBase })
        : Object.freeze({ lang: 'ts' as const, ...inventoryBase });
    fileNodes.set(spec.path, { id, path: spec.path, inventory });
    filesById.set(id, { id, path: spec.path, inventory });
  }
  return {
    graph: Object.freeze({ files: filesById, edges: [], edgesByTarget: new Map() }),
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

describe('private-type-leak — Python disabled (T338)', () => {
  it('Python file with would-be-leak emits zero issues', () => {
    // Public function `processItem` whose body references a non-exported
    // type-decl `Internal`. In TS this would be a leak; in Python the
    // rule short-circuits before reading the file.
    const fix = buildFixture([
      {
        path: '/proj/a.py',
        lang: 'py',
        declarations: [
          decl('Internal', 'type', false, 0, 100),
          decl('processItem', 'function', true, 200, 100),
        ],
        usages: [usage('Internal', 250)],
      },
    ]);
    expect(createPrivateTypeLeakRule('error')(ctx(fix))).toEqual([]);
  });

  it('mixed project: only TS leaks flagged, Python skipped', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        lang: 'ts',
        declarations: [
          decl('Internal', 'type', false, 0, 100),
          decl('processItem', 'function', true, 200, 100),
        ],
        usages: [usage('Internal', 250)],
      },
      {
        path: '/proj/b.py',
        lang: 'py',
        declarations: [
          decl('PyInternal', 'type', false, 0, 100),
          decl('PyExport', 'function', true, 200, 100),
        ],
        usages: [usage('PyInternal', 250)],
      },
    ]);
    const findings = createPrivateTypeLeakRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'private-type-leak') throw new Error('expected');
    expect(f.file).toBe('/proj/a.ts');
    expect(f.leakedType).toBe('Internal');
  });

  it('all-Python project produces zero findings even with apparent leaks', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.py',
        lang: 'py',
        declarations: [
          decl('_PrivateT', 'type', false, 0, 100),
          decl('publicFn', 'function', true, 200, 100),
        ],
        usages: [usage('_PrivateT', 250)],
      },
      {
        path: '/proj/b.py',
        lang: 'py',
        declarations: [
          decl('AnotherInternal', 'type', false, 0, 100),
          decl('exposed', 'function', true, 200, 100),
        ],
        usages: [usage('AnotherInternal', 250)],
      },
    ]);
    expect(createPrivateTypeLeakRule('error')(ctx(fix))).toEqual([]);
  });
});
