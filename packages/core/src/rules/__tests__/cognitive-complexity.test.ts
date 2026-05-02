/**
 * cognitive-complexity.test.ts — Phase 3f.5 (T160) acceptance suite.
 *
 * Mirrors complexity-hotspot but reads the cognitive metric. Default
 * threshold is 15 (strictly-greater).
 */

import type { FugaziConfig } from '@fugazi/config';
import type { FileComplexity, FunctionComplexity } from '@fugazi/extract';
import type { FileNode, Graph } from '@fugazi/graph';
import { type FileId, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { createCognitiveComplexityRule } from '../cognitive-complexity.js';
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

describe('createCognitiveComplexityRule', () => {
  it('(a) cognitive=16 (default threshold 15) → 1 issue', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('foo', 0, 16, 0)]) },
    ]);
    const findings = createCognitiveComplexityRule('error')(ctxOf(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'cognitive-complexity') throw new Error('unexpected');
    expect(f.score).toBe(16);
    expect(f.severity).toBe('error');
  });

  it('(b) cognitive=15 (boundary) → no issue', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('foo', 0, 15, 0)]) },
    ]);
    expect(createCognitiveComplexityRule('error')(ctxOf(fix))).toEqual([]);
  });

  it('(c) two over-threshold fns sorted by byteOffset', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        fc: makeFileComplexity([makeFn('second', 0, 17, 50), makeFn('first', 0, 16, 10)]),
      },
    ]);
    const findings = createCognitiveComplexityRule('error')(ctxOf(fix));
    expect(findings.length).toBe(2);
    expect(findings.map((x) => x.range?.start.byteOffset ?? -1)).toEqual([10, 50]);
  });

  it('(d) custom threshold via config', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('foo', 0, 6, 0)]) },
    ]);
    const config = emptyConfig({
      health: { cognitiveThreshold: 5 },
    } as unknown as Partial<FugaziConfig>);
    expect(createCognitiveComplexityRule('error')(ctxOf(fix, config)).length).toBe(1);
    expect(createCognitiveComplexityRule('error')(ctxOf(fix))).toEqual([]);
  });

  it('(e) verbatim message string', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('myFunc', 0, 16, 0)]) },
    ]);
    const findings = createCognitiveComplexityRule('error')(ctxOf(fix));
    expect(findings[0]?.message).toBe(
      'cognitive-complexity: myFunc has cognitive complexity 16 (threshold 15)',
    );
  });

  it('(f) determinism', () => {
    const fix = buildFixture([
      {
        path: '/proj/b.ts',
        fc: makeFileComplexity([makeFn('a', 0, 16, 0), makeFn('b', 0, 17, 50)]),
      },
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('c', 0, 18, 100)]) },
    ]);
    const a = createCognitiveComplexityRule('error')(ctxOf(fix));
    const b = createCognitiveComplexityRule('error')(ctxOf(fix));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((x) => x.file)).toEqual(['/proj/a.ts', '/proj/b.ts', '/proj/b.ts']);
  });

  it('degrades to no-emit when ctx.complexity is undefined', () => {
    const fix = buildFixture([
      { path: '/proj/a.ts', fc: makeFileComplexity([makeFn('foo', 0, 99, 0)]) },
    ]);
    const ctx: RuleContext = {
      graph: fix.graph,
      fileNodes: fix.fileNodes,
      projectRoot: '/proj',
      entryPoints: [],
      config: emptyConfig(),
    };
    expect(createCognitiveComplexityRule('error')(ctx)).toEqual([]);
  });
});
