/**
 * boundaries.test.ts — Phase 3f.3 (T151-T152) acceptance suite.
 *
 * In-memory fixtures only. Each fixture builds a synthetic Graph + zone config
 * and asserts the boundary-violations rule emits the expected findings.
 */

import type { FugaziConfig } from '@fugazi/config';
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
    const node: FileNode = {
      id,
      path: spec.path,
      inventory: Object.freeze({
        declarations: Object.freeze([]),
        imports: Object.freeze([]),
        usages: Object.freeze([]),
      }),
    };
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

function ctx(fixture: ReturnType<typeof buildFixture>, zones?: Zones): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot: PROJECT_ROOT,
    entryPoints: [],
    config: makeConfig(zones),
  };
}

describe('createBoundaryViolationsRule', () => {
  it('(a) a→b allowed by config → no violation', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        a: { pattern: ['a.ts'], canImport: ['b'] },
        b: { pattern: ['b.ts'], canImport: [] },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('(b) b→c allowed by config → no violation', () => {
    const fix = buildFixture([
      { path: '/proj/b.ts', importsTo: ['/proj/c.ts'] },
      { path: '/proj/c.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        b: { pattern: ['b.ts'], canImport: ['c'] },
        c: { pattern: ['c.ts'], canImport: [] },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('(c) a→c when only a→b is allowed → violation with verbatim message', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/c.ts'] },
      { path: '/proj/b.ts' },
      { path: '/proj/c.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        a: { pattern: ['a.ts'], canImport: ['b'] },
        b: { pattern: ['b.ts'], canImport: [] },
        c: { pattern: ['c.ts'], canImport: [] },
      }),
    );
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'boundary-violations') {
      throw new Error('unexpected');
    }
    expect(finding.message).toBe('boundary-violations: a may not import c');
    expect(finding.from).toBe('/proj/a.ts');
    expect(finding.to).toBe('/proj/c.ts');
    expect(finding.fromZone).toBe('a');
    expect(finding.toZone).toBe('c');
    expect(finding.file).toBe('/proj/a.ts');
  });

  it('(d) re-export case: a→b allowed, b→c flagged on the b→c direct edge', () => {
    // a.ts imports b.ts (allowed under a→b); b.ts re-exports from c.ts which
    // shows up in the graph as a direct b→c edge. Only the b→c hop violates.
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts', importsTo: ['/proj/c.ts'] },
      { path: '/proj/c.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        a: { pattern: ['a.ts'], canImport: ['b'] },
        b: { pattern: ['b.ts'], canImport: [] },
        c: { pattern: ['c.ts'], canImport: [] },
      }),
    );
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'boundary-violations') {
      throw new Error('unexpected');
    }
    expect(finding.from).toBe('/proj/b.ts');
    expect(finding.to).toBe('/proj/c.ts');
    expect(finding.fromZone).toBe('b');
    expect(finding.toZone).toBe('c');
    expect(finding.message).toBe('boundary-violations: b may not import c');
  });

  it('(e) file with no matching zone is skipped (no violation)', () => {
    const fix = buildFixture([
      { path: '/proj/orphan.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        b: { pattern: ['b.ts'], canImport: [] },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('(f) empty canImport array → all out-of-zone imports flagged', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts', '/proj/c.ts'] },
      { path: '/proj/b.ts' },
      { path: '/proj/c.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        a: { pattern: ['a.ts'], canImport: [] },
        b: { pattern: ['b.ts'], canImport: [] },
        c: { pattern: ['c.ts'], canImport: [] },
      }),
    );
    expect(findings.length).toBe(2);
    expect(findings.map((f) => (f.kind === 'boundary-violations' ? f.to : ''))).toEqual([
      '/proj/b.ts',
      '/proj/c.ts',
    ]);
  });

  it('(g) determinism: same fixture run twice → byte-equal output', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts', '/proj/c.ts'] },
      { path: '/proj/b.ts', importsTo: ['/proj/c.ts'] },
      { path: '/proj/c.ts' },
    ]);
    const zones: Zones = {
      a: { pattern: ['a.ts'], canImport: ['b'] },
      b: { pattern: ['b.ts'], canImport: [] },
      c: { pattern: ['c.ts'], canImport: [] },
    };
    const rule = createBoundaryViolationsRule('error');
    const r1 = JSON.stringify(rule(ctx(fix, zones)));
    const r2 = JSON.stringify(rule(ctx(fix, zones)));
    expect(r1).toBe(r2);
  });

  it('emits no findings when config.zones is absent', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['/proj/b.ts'] },
      { path: '/proj/b.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('skips edges with to === ROOT_FILE_ID (external/unresolved)', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', importsTo: ['react'] }, // unresolved → ROOT
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        a: { pattern: ['a.ts'], canImport: [] },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('intra-zone imports are never flagged', () => {
    const fix = buildFixture([
      { path: '/proj/src/a.ts', importsTo: ['/proj/src/b.ts'] },
      { path: '/proj/src/b.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        src: { pattern: ['src/**'], canImport: [] },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('** glob matches nested segments', () => {
    const fix = buildFixture([
      { path: '/proj/src/app/page.ts', importsTo: ['/proj/src/infra/db.ts'] },
      { path: '/proj/src/infra/db.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        app: { pattern: ['src/app/**'], canImport: [] },
        infra: { pattern: ['src/infra/**'], canImport: [] },
      }),
    );
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'boundary-violations') {
      throw new Error('unexpected');
    }
    expect(finding.message).toBe('boundary-violations: app may not import infra');
  });

  it('first-match-wins zone classification (insertion order)', () => {
    // app.ts matches BOTH zone "a" (literal "app.ts") AND zone "b" (`*.ts`);
    // the first-declared zone in alphabetical key order is "a", so app.ts is
    // classified there. x.ts only matches zone "b". The single edge a → b
    // produces one violation with the expected zone names.
    const fix = buildFixture([
      { path: '/proj/app.ts', importsTo: ['/proj/x.ts'] },
      { path: '/proj/x.ts' },
    ]);
    const rule = createBoundaryViolationsRule('error');
    const findings = rule(
      ctx(fix, {
        a: { pattern: ['app.ts'], canImport: [] },
        b: { pattern: ['*.ts'], canImport: [] },
      }),
    );
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'boundary-violations') {
      throw new Error('unexpected');
    }
    expect(finding.fromZone).toBe('a');
    expect(finding.toZone).toBe('b');
  });
});
