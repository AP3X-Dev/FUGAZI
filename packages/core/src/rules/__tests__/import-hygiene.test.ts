/**
 * import-hygiene.test.ts — Phase 3f.2 Wave 2 (T148) acceptance suite.
 *
 * In-memory module-graph fixtures + transient package.json. Asserts the
 * shared walker correctly partitions unresolved-imports from
 * unlisted-dependencies and detects duplicate-exports per file.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import type { Declaration, Inventory } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __clearImportHygieneCacheForTest,
  createDuplicateExportsRule,
  createUnlistedDependenciesRule,
  createUnresolvedImportsRule,
} from '../import-hygiene.js';
import type { RuleContext } from '../types.js';

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

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
  byteOffset = 0,
): Declaration {
  return { kind, name, exported, range: range(byteOffset), members: [] };
}

interface FileSpec {
  readonly path: string;
  readonly declarations?: readonly Declaration[];
  readonly imports?: readonly { specifier: string; resolveTo?: string }[];
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
    fileNodes.set(spec.path, { id, path: spec.path, inventory });
    filesById.set(id, { id, path: spec.path, inventory });
  }
  const edges: Edge[] = [];
  for (const spec of sorted) {
    const fromId = ids.get(spec.path);
    if (fromId === undefined) continue;
    for (const imp of spec.imports ?? []) {
      const target = imp.resolveTo;
      if (target !== undefined) {
        const toId = ids.get(target);
        if (toId !== undefined) {
          edges.push({
            from: fromId,
            to: toId,
            kind: 'static',
            specifier: imp.specifier,
            resolvable: true,
            loc: ZERO_RANGE,
          });
          continue;
        }
      }
      edges.push({
        from: fromId,
        to: ROOT_FILE_ID,
        kind: 'static',
        specifier: imp.specifier,
        resolvable: false,
        loc: ZERO_RANGE,
      });
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

let projectRoot = '';

function ctx(fixture: ReturnType<typeof buildFixture>): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot,
    entryPoints: [],
    config: emptyConfig(),
  };
}

function writeManifest(content: object): void {
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify(content), 'utf8');
}

describe('import-hygiene family', () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'fugazi-import-hygiene-')).split('\\').join('/');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('(a) bare import of declared dep that fails to resolve → unresolved-imports', () => {
    writeManifest({ dependencies: { react: '^18' } });
    const fix = buildFixture([{ path: '/proj/a.ts', imports: [{ specifier: 'react' }] }]);
    const findings = createUnresolvedImportsRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unresolved-imports') throw new Error('x');
    expect(f.specifier).toBe('react');
  });

  it('(b) bare import of NOT-declared dep → unlisted-dependencies', () => {
    writeManifest({});
    const fix = buildFixture([{ path: '/proj/a.ts', imports: [{ specifier: 'lodash' }] }]);
    const findings = createUnlistedDependenciesRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'unlisted-dependencies') throw new Error('x');
    expect(f.specifier).toBe('lodash');
  });

  it("(c) relative import that didn't resolve → unresolved-imports", () => {
    writeManifest({});
    const fix = buildFixture([{ path: '/proj/a.ts', imports: [{ specifier: './missing' }] }]);
    const findings = createUnresolvedImportsRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
  });

  it('(d) duplicate exports in one file → one duplicate-exports issue', () => {
    writeManifest({});
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'function', true, 0), decl('Foo', 'class', true, 50)],
      },
    ]);
    const findings = createDuplicateExportsRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'duplicate-exports') throw new Error('x');
    expect(f.exportName).toBe('Foo');
    expect(f.occurrences.length).toBe(2);
  });

  it('(e) css-class duplicates are NOT flagged', () => {
    writeManifest({});
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('button', 'css-class', true, 0), decl('button', 'css-class', true, 50)],
      },
    ]);
    expect(createDuplicateExportsRule('error')(ctx(fix))).toEqual([]);
  });

  it('verbatim message format (unresolved-imports)', () => {
    writeManifest({ dependencies: { react: '^18' } });
    const fix = buildFixture([{ path: '/proj/a.ts', imports: [{ specifier: 'react' }] }]);
    const findings = createUnresolvedImportsRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe('unresolved-imports: cannot resolve react from /proj/a.ts');
  });

  it('verbatim message format (unlisted-dependencies)', () => {
    writeManifest({});
    const fix = buildFixture([{ path: '/proj/a.ts', imports: [{ specifier: 'lodash' }] }]);
    const findings = createUnlistedDependenciesRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe(
      'unlisted-dependencies: lodash is not declared in package.json',
    );
  });

  it('verbatim message format (duplicate-exports)', () => {
    writeManifest({});
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('Foo', 'function', true, 0), decl('Foo', 'class', true, 50)],
      },
    ]);
    const findings = createDuplicateExportsRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe('duplicate-exports: Foo declared 2 times in /proj/a.ts');
  });

  it('peerDependencies count as declared (not unlisted)', () => {
    writeManifest({ peerDependencies: { react: '^18' } });
    const fix = buildFixture([{ path: '/proj/a.ts', imports: [{ specifier: 'react' }] }]);
    expect(createUnlistedDependenciesRule('error')(ctx(fix))).toEqual([]);
  });

  it('node: scheme imports are NOT classified as bare → fall to unresolved', () => {
    writeManifest({});
    const fix = buildFixture([{ path: '/proj/a.ts', imports: [{ specifier: 'node:fs' }] }]);
    const findings = createUnresolvedImportsRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
  });

  it('determinism: same fixture twice → byte-equal output', () => {
    writeManifest({ dependencies: { react: '^18' } });
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        imports: [{ specifier: 'react' }, { specifier: 'lodash' }],
      },
    ]);
    const c = ctx(fix);
    const r1 = JSON.stringify(createUnresolvedImportsRule('error')(c));
    __clearImportHygieneCacheForTest(c);
    const r2 = JSON.stringify(createUnresolvedImportsRule('error')(c));
    expect(r1).toBe(r2);
  });
});
