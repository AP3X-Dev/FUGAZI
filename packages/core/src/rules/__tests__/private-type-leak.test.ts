/**
 * private-type-leak.test.ts — Phase 3f.2 Wave 2 (T150) acceptance suite.
 *
 * In-memory fixtures only. Asserts the byte-range overlap heuristic
 * documented in the rule header: an `identifier`/`member` Usage whose name
 * matches a private type and whose range falls inside an exported public
 * symbol's range is flagged.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Declaration, Inventory, Usage } from '@fugazi/extract';
import type { FileNode, Graph } from '@fugazi/graph';
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

function range(startOffset: number, endOffset: number): Range {
  return {
    start: { line: 1, column: 0, byteOffset: startOffset },
    end: { line: 1, column: 1, byteOffset: endOffset },
  };
}

function decl(
  name: string,
  kind: Declaration['kind'],
  exported: boolean,
  startOffset: number,
  endOffset: number,
): Declaration {
  return { kind, name, exported, range: range(startOffset, endOffset), members: [] };
}

function usage(name: string, kind: Usage['kind'], startOffset: number, endOffset: number): Usage {
  return { kind, name, range: range(startOffset, endOffset) };
}

interface FileSpec {
  readonly path: string;
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
    const inventory: Inventory = Object.freeze({
      declarations: Object.freeze([...(spec.declarations ?? [])]),
      imports: Object.freeze([]),
      usages: Object.freeze([...(spec.usages ?? [])]),
    });
    const node: FileNode = { id, path: spec.path, inventory };
    fileNodes.set(spec.path, node);
    filesById.set(id, node);
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

describe('createPrivateTypeLeakRule', () => {
  it('(a) public function returns private type → flagged', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [
          decl('Internal', 'type', false, 0, 30), // private type
          decl('makeThing', 'function', true, 40, 100), // public function range covers usage
        ],
        usages: [usage('Internal', 'identifier', 50, 58)],
      },
    ]);
    const rule = createPrivateTypeLeakRule('error');
    const findings = rule(ctx(fix));
    expect(findings.length).toBe(1);
    const finding = findings[0];
    if (finding === undefined || finding.kind !== 'private-type-leak') {
      throw new Error('unexpected');
    }
    expect(finding.leakedType).toBe('Internal');
    expect(finding.publicSymbol).toBe('makeThing');
  });

  it('(b) public symbol does not reference private type → no findings', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [
          decl('Internal', 'type', false, 0, 30),
          decl('safe', 'function', true, 40, 100),
        ],
        usages: [usage('Other', 'identifier', 50, 55)],
      },
    ]);
    const rule = createPrivateTypeLeakRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('(c) usage of private type outside any public symbol range → no findings', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [
          decl('Internal', 'type', false, 0, 30),
          decl('publicFn', 'function', true, 100, 200),
        ],
        // Usage is between the type decl and the public fn — not enclosed.
        usages: [usage('Internal', 'identifier', 60, 68)],
      },
    ]);
    const rule = createPrivateTypeLeakRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('(d) member-kind usage of private type → flagged', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [decl('Cfg', 'type', false, 0, 20), decl('build', 'function', true, 30, 200)],
        usages: [usage('Cfg', 'member', 50, 53)],
      },
    ]);
    const rule = createPrivateTypeLeakRule('error');
    const findings = rule(ctx(fix));
    expect(findings.length).toBe(1);
  });

  it('verbatim message format', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [
          decl('Internal', 'type', false, 0, 30),
          decl('pub', 'function', true, 40, 100),
        ],
        usages: [usage('Internal', 'identifier', 50, 58)],
      },
    ]);
    const rule = createPrivateTypeLeakRule('error');
    const findings = rule(ctx(fix));
    expect(findings[0]?.message).toBe(
      'private-type-leak: Internal leaks into public signature of pub in /proj/a.ts',
    );
  });

  it('determinism: same fixture twice → byte-equal output', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [
          decl('A', 'type', false, 0, 10),
          decl('B', 'type', false, 11, 20),
          decl('pub', 'function', true, 30, 200),
        ],
        usages: [usage('A', 'identifier', 40, 41), usage('B', 'identifier', 60, 61)],
      },
    ]);
    const rule = createPrivateTypeLeakRule('error');
    const r1 = JSON.stringify(rule(ctx(fix)));
    const r2 = JSON.stringify(rule(ctx(fix)));
    expect(r1).toBe(r2);
  });

  it('exported types are NOT considered private', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [
          decl('PublicType', 'type', true, 0, 30),
          decl('pub', 'function', true, 40, 100),
        ],
        usages: [usage('PublicType', 'identifier', 50, 58)],
      },
    ]);
    const rule = createPrivateTypeLeakRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });

  it('non-exported public symbols are not considered (only public surface counts)', () => {
    const fix = buildFixture([
      {
        path: '/proj/a.ts',
        declarations: [
          decl('Internal', 'type', false, 0, 30),
          decl('helper', 'function', false, 40, 100), // not exported
        ],
        usages: [usage('Internal', 'identifier', 50, 58)],
      },
    ]);
    const rule = createPrivateTypeLeakRule('error');
    expect(rule(ctx(fix))).toEqual([]);
  });
});
