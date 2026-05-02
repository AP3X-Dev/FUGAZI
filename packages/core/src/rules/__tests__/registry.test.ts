/**
 * registry.test.ts — Phase 3f.2 Wave 1 — registry-level dispatch suite.
 *
 * Covers:
 *   - Mode dispatch:
 *       audit  → no rules, no diagnostics regardless of registry contents.
 *       full   → every registered rule runs.
 *       dead-code-only → only the dead-code-family rules.
 *       dupes-only / health-only → none of Wave 1's rules fire.
 *   - Severity gate: a rule whose configured severity is `'off'` is skipped.
 *   - Deterministic alphabetical iteration of rule ids regardless of insertion
 *     order in the registry Map.
 *   - Returned issues are sorted by `(file, byteOffset, kind)`.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Declaration, Inventory } from '@fugazi/extract';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, type RuleId, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { DEAD_CODE_RULES, RULES, listEnabledRules, runEnabledRules } from '../registry.js';
import type { RuleContext } from '../types.js';

interface FileSpec {
  readonly path: string;
  readonly declarations?: readonly Declaration[];
}

function configWith(rules: FugaziConfig['rules'] = {}): FugaziConfig {
  return {
    rules,
    include: [],
    exclude: [],
    production: false,
    strict: false,
    experimentalTsPlugins: false,
  };
}

function decl(
  name: string,
  kind: Declaration['kind'],
  exported: boolean,
  byteOffset: number,
): Declaration {
  return {
    kind,
    name,
    exported,
    range: {
      start: { line: 1, column: 0, byteOffset },
      end: { line: 1, column: 1, byteOffset: byteOffset + 1 },
    },
    members: [],
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
      declarations: Object.freeze([...(spec.declarations ?? [])]),
      imports: Object.freeze([]),
      usages: Object.freeze([]),
    });
    const node: FileNode = { id, path: spec.path, inventory };
    fileNodes.set(spec.path, node);
    filesById.set(id, node);
  }
  const edges: readonly Edge[] = Object.freeze([]);
  const edgesByTarget = new Map<FileId, readonly Edge[]>();
  return {
    graph: Object.freeze({ files: filesById, edges, edgesByTarget }),
    fileNodes,
  };
}

function ctx(
  fixture: ReturnType<typeof buildFixture>,
  config: FugaziConfig,
  entryPoints: readonly string[] = ['/proj/entry.ts'],
): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot: '/proj',
    entryPoints,
    config,
  };
}

describe('runEnabledRules', () => {
  it('audit mode: returns no diagnostics even when fixture would otherwise flag', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('foo', 'function', true, 0), decl('Bar', 'type', true, 50)],
      },
    ]);
    const result = runEnabledRules(ctx(fix, configWith()), 'audit', configWith());
    expect(result.issues).toEqual([]);
    expect(result.enabledRules).toEqual([]);
  });

  it('dead-code-only mode: dispatches every dead-code-family rule registered in Waves 1+2', () => {
    const fix = buildFixture([{ path: '/proj/entry.ts' }]);
    const result = runEnabledRules(ctx(fix, configWith()), 'dead-code-only', configWith());
    // Waves 1+2 register all 13 dead-code rules; every enabled rule must be in
    // DEAD_CODE_RULES, and the enabled list must be alphabetically sorted.
    expect(result.enabledRules).toEqual([...DEAD_CODE_RULES].sort());
    for (const r of result.enabledRules) {
      expect(DEAD_CODE_RULES.has(r)).toBe(true);
    }
  });

  it('full mode: dispatches every registered rule', () => {
    const fix = buildFixture([{ path: '/proj/entry.ts' }]);
    const result = runEnabledRules(ctx(fix, configWith()), 'full', configWith());
    const expected = [...RULES.keys()].sort();
    expect(result.enabledRules).toEqual(expected);
  });

  it('dupes-only / health-only mode: no Wave 1 rule fires', () => {
    const fix = buildFixture([{ path: '/proj/entry.ts' }]);
    const dupes = runEnabledRules(ctx(fix, configWith()), 'dupes-only', configWith());
    const health = runEnabledRules(ctx(fix, configWith()), 'health-only', configWith());
    expect(dupes.enabledRules).toEqual([]);
    expect(health.enabledRules).toEqual([]);
  });

  it("severity 'off' skips that rule even in full mode; other rules unaffected", () => {
    const cfg = configWith({ 'unused-types': 'off' });
    const fix = buildFixture([{ path: '/proj/entry.ts' }]);
    const result = runEnabledRules(ctx(fix, cfg), 'full', cfg);
    expect(result.enabledRules).toContain('unused-files');
    expect(result.enabledRules).toContain('unused-exports');
    expect(result.enabledRules).not.toContain('unused-types');
  });

  it('rule iteration order is alphabetical by RuleId', () => {
    const cfg = configWith();
    const fix = buildFixture([{ path: '/proj/entry.ts' }]);
    const result = runEnabledRules(ctx(fix, cfg), 'full', cfg);
    const sorted = [...result.enabledRules].sort();
    expect(result.enabledRules).toEqual(sorted);
  });

  it('listEnabledRules returns the same RuleIds as the dispatcher walks', () => {
    const cfg = configWith({ 'unused-files': 'warn' });
    const enabled = listEnabledRules('full', cfg);
    const fix = buildFixture([{ path: '/proj/entry.ts' }]);
    const result = runEnabledRules(ctx(fix, cfg), 'full', cfg);
    expect(result.enabledRules).toEqual(enabled);
  });

  it('issues are sorted by (file, byteOffset, kind)', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('foo', 'function', true, 100), decl('bar', 'function', true, 0)],
      },
      {
        path: '/proj/b.ts',
        declarations: [decl('Baz', 'type', true, 0)],
      },
    ]);
    const cfg = configWith();
    const result = runEnabledRules(ctx(fix, cfg), 'full', cfg);
    // Both a.ts findings come before b.ts findings; within a.ts, byteOffset
    // 0 (bar) precedes byteOffset 100 (foo).
    const triples = result.issues.map((i) => ({
      file: i.file,
      offset: i.range?.start.byteOffset ?? -1,
      kind: i.kind,
    }));
    for (let i = 1; i < triples.length; i++) {
      const prev = triples[i - 1];
      const cur = triples[i];
      if (prev === undefined || cur === undefined) continue;
      const ordered = prev.file < cur.file || (prev.file === cur.file && prev.offset <= cur.offset);
      expect(ordered).toBe(true);
    }
  });

  it('onRuleStart fires for each rule with monotonically increasing n', () => {
    const fix = buildFixture([{ path: '/proj/entry.ts' }]);
    const cfg = configWith();
    const observed: { rule: RuleId; n: number; total: number }[] = [];
    runEnabledRules(ctx(fix, cfg), 'full', cfg, (rule, n, total) => {
      observed.push({ rule, n, total });
    });
    const expected = [...RULES.keys()].sort();
    expect(observed.length).toBe(expected.length);
    for (let i = 0; i < observed.length; i++) {
      expect(observed[i]?.n).toBe(i + 1);
      expect(observed[i]?.total).toBe(expected.length);
    }
  });

  it('diagnosticsByRule has a count entry for every rule that ran', () => {
    const fix = buildFixture([
      { path: '/proj/entry.ts' },
      {
        path: '/proj/a.ts',
        declarations: [decl('foo', 'function', true, 0)],
      },
    ]);
    const cfg = configWith();
    const result = runEnabledRules(ctx(fix, cfg), 'full', cfg);
    // unused-files emits 1 (for /proj/a.ts), unused-exports emits 1 (for foo),
    // unused-types emits 0.
    expect(result.diagnosticsByRule['unused-files']).toBe(1);
    expect(result.diagnosticsByRule['unused-exports']).toBe(1);
    expect(result.diagnosticsByRule['unused-types']).toBe(0);
  });
});
