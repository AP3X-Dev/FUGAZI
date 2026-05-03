/**
 * complexity-py.test.ts — Phase 4c T335 acceptance suite.
 *
 * Verifies that `complexity-hotspot` and `cognitive-complexity` rules
 * consume Python `FileComplexity` records identically to TS. The
 * complexity computation pipeline (Phase 4a T309) emits the same
 * `FileComplexity` shape regardless of source language; these tests
 * confirm rule wiring works on `.py` paths.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { FileComplexity, FunctionComplexity, Inventory } from '@fugazi/extract';
import type { FileNode, Graph } from '@fugazi/graph';
import { type FileId, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { createCognitiveComplexityRule } from '../cognitive-complexity.js';
import { createComplexityHotspotRule } from '../complexity-hotspot.js';
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

function pyEmptyInventory(): Inventory {
  return Object.freeze({
    lang: 'py',
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
    const node: FileNode = { id, path: s.path, inventory: pyEmptyInventory() };
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

function ctx(fix: ReturnType<typeof buildFixture>): RuleContext {
  return {
    graph: fix.graph,
    fileNodes: fix.fileNodes,
    projectRoot: '/proj',
    entryPoints: [],
    config: emptyConfig(),
    complexity: fix.complexity,
  };
}

describe('complexity-hotspot — Python (T335)', () => {
  it('Python function with cyclomatic > threshold → flagged', () => {
    const fix = buildFixture([
      { path: '/proj/svc.py', fc: makeFileComplexity([makeFn('process', 12, 0, 0)]) },
    ]);
    const findings = createComplexityHotspotRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'complexity-hotspot') throw new Error('expected');
    expect(f.file).toBe('/proj/svc.py');
    expect(f.score).toBe(12);
  });

  it('Python function with cyclomatic ≤ threshold → NOT flagged', () => {
    const fix = buildFixture([
      { path: '/proj/svc.py', fc: makeFileComplexity([makeFn('simple', 5, 0, 0)]) },
    ]);
    expect(createComplexityHotspotRule('error')(ctx(fix))).toEqual([]);
  });

  it('verbatim message format matches TS', () => {
    const fix = buildFixture([
      { path: '/proj/svc.py', fc: makeFileComplexity([makeFn('handler', 11, 0, 0)]) },
    ]);
    const findings = createComplexityHotspotRule('error')(ctx(fix));
    expect(findings[0]?.message).toBe(
      'complexity-hotspot: handler has cyclomatic complexity 11 (threshold 10)',
    );
  });
});

describe('cognitive-complexity — Python (T335)', () => {
  it('Python function with cognitive > threshold → flagged', () => {
    const fix = buildFixture([
      { path: '/proj/svc.py', fc: makeFileComplexity([makeFn('handler', 0, 20, 0)]) },
    ]);
    const findings = createCognitiveComplexityRule('error')(ctx(fix));
    expect(findings.length).toBe(1);
    const f = findings[0];
    if (f === undefined || f.kind !== 'cognitive-complexity') throw new Error('expected');
    expect(f.file).toBe('/proj/svc.py');
    expect(f.score).toBe(20);
  });

  it('Python function with cognitive ≤ threshold → NOT flagged', () => {
    const fix = buildFixture([
      { path: '/proj/svc.py', fc: makeFileComplexity([makeFn('simple', 0, 5, 0)]) },
    ]);
    expect(createCognitiveComplexityRule('error')(ctx(fix))).toEqual([]);
  });
});
