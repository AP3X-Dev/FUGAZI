/**
 * complexity-hotspot.test.ts — Phase 3f.5 (T158) acceptance suite.
 *
 * In-memory fixtures only. Fabricates `FileComplexity` literals and pairs
 * them with a synthetic Graph; asserts emission against the rule's threshold
 * + sort + verbatim message contract.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { FileComplexity, FunctionComplexity } from '@fugazi/extract';
import type { FileNode, Graph } from '@fugazi/graph';
import { type FileId, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { createComplexityHotspotRule } from '../complexity-hotspot.js';
import type { RuleContext } from '../types.js';

function emptyConfig(extras?: Partial<FugaziConfig>): FugaziConfig {
  return {
    rules: {},
    include: [],
    exclude: [],
    production: false,
    strict: false,
    experimentalTsPlugins: false,
    ...extras,
  };
}

function emptyInventory() {
  return Object.freeze({
    declarations: Object.freeze([]),
    imports: Object.freeze([]),
    usages: Object.freeze([]),
  });
}

function makeRange(byteOffset: number): Range {
  return {
    start: { line: 1, column: 0, byteOffset },
    end: { line: 1, column: 1, byteOffset: byteOffset + 1 },
  };
}

function makeFn(
  name: string,
  cyclomatic: number,
  cognitive: number,
  byteOffset: number,
): FunctionComplexity {
  return Object.freeze({
    name,
    cyclomatic,
    cognitive,
    maintainabilityIndex: 100,
    loc: 1,
    range: makeRange(byteOffset),
  });
}

function makeFileComplexity(fns: readonly FunctionComplexity[]): FileComplexity {
  let cyc = 0;
  let cog = 0;
  for (const f of fns) {
    cyc += f.cyclomatic;
    cog += f.cognitive;
  }
  return Object.freeze({
    functions: Object.freeze([...fns]),
    aggregate: Object.freeze({
      cyclomatic: cyc,
      cognitive: cog,
      maintainabilityIndex: 100,
      loc: fns.length,
    }),
  });
}

function buildFixture(specs: readonly { path: string; fc: FileComplexity }[]): {
  graph: Graph;
  fileNodes: ReadonlyMap<string, FileNode>;
  complexity: ReadonlyMap<FileId, FileComplexity>;
} {
  const sorted = [...specs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const ids = assignFileIds(sorted.map((s) => s.path));
  const fileNodes = new Map<string, FileNode>();
  const filesById = new Map<FileId, FileNode>();
  const complexity = new Map<FileId, FileComplexity>();
  for (const s of sorted) {
    const id = ids.get(s.path);
    if (id === undefined) throw new Error(`no id for ${s.path}`);
    const node: FileNode = { id, path: s.path, inventory: emptyInventory() };
    fileNodes.set(s.path, node);
    filesById.set(id, node);
    complexity.set(id, s.fc);
  }
  const graph: Graph = Object.freeze({
    files: filesById,
    edges: [],
    edgesByTarget: new Map(),
  });
  return { graph, fileNodes, complexity };
}

function ctxOf(
  fix: ReturnType<typeof buildFixture>,
  config: FugaziConfig = emptyConfig(),
): RuleContext {
  return {
    graph: fix.graph,
    fileNodes: fix.fileNodes,
    projectRoot: '/proj',
    entryPoints: [],
    config,
    complexity: fix.complexity,
  };
}

describe('createComplexityHotspotRule', () => {
  it('(a) function with cyclomatic=11 (default threshold 10) → 1 issue', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('foo', 11, 0, 0)]) },
    ]);
    const findings = createComplexityHotspotRule('error')(ctxOf(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'complexity-hotspot') throw new Error('unexpected');
    expect(f.score).toBe(11);
    expect(f.metric).toBe('cyclomatic');
    expect(f.severity).toBe('error');
    expect(f.file).toBe('/proj/a.ts');
  });

  it('(b) cyclomatic=10 (boundary, > not >=) → no issue', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('foo', 10, 0, 0)]) },
    ]);
    expect(createComplexityHotspotRule('error')(ctxOf(fix))).toEqual([]);
  });

  it('(c) two over-threshold fns in same file → 2 issues sorted by byteOffset', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        fc: makeFileComplexity([makeFn('second', 12, 0, 50), makeFn('first', 11, 0, 10)]),
      },
    ]);
    const findings = createComplexityHotspotRule('error')(ctxOf(fix));
    expect(findings.length).toBe(2);
    const offsets = findings.map((x) => x.range?.start.byteOffset ?? -1);
    expect(offsets).toEqual([10, 50]);
  });

  it('(d) custom threshold via config respected', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('foo', 6, 0, 0)]) },
    ]);
    const config = emptyConfig({
      health: { cyclomaticThreshold: 5 },
    } as unknown as Partial<FugaziConfig>);
    const findings = createComplexityHotspotRule('error')(ctxOf(fix, config));
    expect(findings.length).toBe(1);
    // Verify default would NOT have flagged it (cyc=6 < 10)
    const findingsDefault = createComplexityHotspotRule('error')(ctxOf(fix));
    expect(findingsDefault).toEqual([]);
  });

  it('(e) verbatim message string', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('myFunc', 11, 0, 0)]) },
    ]);
    const findings = createComplexityHotspotRule('error')(ctxOf(fix));
    expect(findings[0]?.message).toBe(
      'complexity-hotspot: myFunc has cyclomatic complexity 11 (threshold 10)',
    );
  });

  it('(f) determinism: two runs identical', () => {
    const fix = buildFixture([
      {
        path: '/proj/b.ts',
        fc: makeFileComplexity([makeFn('a', 11, 0, 0), makeFn('b', 12, 0, 50)]),
      },
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('c', 13, 0, 100)]) },
    ]);
    const a = createComplexityHotspotRule('error')(ctxOf(fix));
    const b = createComplexityHotspotRule('error')(ctxOf(fix));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // sort: file then byteOffset
    expect(a.map((x) => x.file)).toEqual(['/proj/a.ts', '/proj/b.ts', '/proj/b.ts']);
  });

  it('degrades to no-emit when ctx.complexity is undefined', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('foo', 99, 0, 0)]) },
    ]);
    const ctx: RuleContext = {
      graph: fix.graph,
      fileNodes: fix.fileNodes,
      projectRoot: '/proj',
      entryPoints: [],
      config: emptyConfig(),
    };
    expect(createComplexityHotspotRule('error')(ctx)).toEqual([]);
  });
});
