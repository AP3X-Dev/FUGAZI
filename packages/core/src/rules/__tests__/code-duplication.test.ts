/**
 * code-duplication.test.ts — Phase 3f.4 Wave B (T-CD).
 *
 * The rule reads source files from disk, so this suite writes fixtures to a
 * temp dir and points a synthetic Graph at them. Cleanup runs afterEach.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import type { Edge, FileNode, Graph } from '@fugazi/graph';
import { type FileId, assignFileIds } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodeDuplicationRule } from '../code-duplication.js';
import type { RuleContext } from '../types.js';

interface FileSpec {
  readonly relPath: string;
  readonly source: string;
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

function emptyInventory() {
  return Object.freeze({
    declarations: Object.freeze([]),
    imports: Object.freeze([]),
    usages: Object.freeze([]),
  });
}

function buildFixture(rootDir: string, specs: readonly FileSpec[]) {
  const sorted = [...specs].sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
  );
  const absPaths = sorted.map((s) => toPosix(join(rootDir, s.relPath)));
  const ids = assignFileIds(absPaths);
  const fileNodes = new Map<string, FileNode>();
  const filesById = new Map<FileId, FileNode>();
  for (let i = 0; i < sorted.length; i++) {
    const spec = sorted[i];
    const path = absPaths[i];
    if (spec === undefined || path === undefined) continue;
    const id = ids.get(path);
    if (id === undefined) throw new Error(`no id for ${path}`);
    const node: FileNode = { id, path, inventory: emptyInventory() };
    fileNodes.set(path, node);
    filesById.set(id, node);
  }
  const edges: readonly Edge[] = [];
  const edgesByTarget = new Map<FileId, Edge[]>();
  const graph: Graph = Object.freeze({ files: filesById, edges, edgesByTarget });
  return { graph, fileNodes };
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function ctx(
  fixture: ReturnType<typeof buildFixture>,
  rootDir: string,
  config: FugaziConfig = emptyConfig(),
): RuleContext {
  return {
    graph: fixture.graph,
    fileNodes: fixture.fileNodes,
    projectRoot: toPosix(rootDir),
    entryPoints: [],
    config,
  };
}

const sharedBlock = (): string => {
  const lines: string[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(`function f${i}(x) { return x + ${i}; }`);
  }
  return lines.join('\n');
};

describe('createCodeDuplicationRule', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fugazi-dupes-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(rel: string, source: string) {
    const abs = join(dir, rel);
    writeFileSync(abs, source, 'utf8');
  }

  it('two files with identical 50+ token block → one type-1 finding', () => {
    write('a.ts', sharedBlock());
    write('b.ts', sharedBlock());
    const fix = buildFixture(dir, [
      { relPath: 'a.ts', source: sharedBlock() },
      { relPath: 'b.ts', source: sharedBlock() },
    ]);
    const rule = createCodeDuplicationRule('error');
    const findings = rule(ctx(fix, dir));
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const top = findings[0];
    expect(top?.kind).toBe('code-duplication');
    if (top !== undefined && top.kind === 'code-duplication') {
      expect(top.cloneType).toBe(1);
      expect(top.occurrences.length).toBeGreaterThanOrEqual(2);
      expect(top.severity).toBe('error');
    }
  });

  it('verbatim message format', () => {
    write('a.ts', sharedBlock());
    write('b.ts', sharedBlock());
    const fix = buildFixture(dir, [
      { relPath: 'a.ts', source: sharedBlock() },
      { relPath: 'b.ts', source: sharedBlock() },
    ]);
    const rule = createCodeDuplicationRule('warn');
    const findings = rule(ctx(fix, dir));
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const top = findings[0];
    if (top === undefined || top.kind !== 'code-duplication') throw new Error('unexpected');
    // Match the verbatim format exactly: `code-duplication: type-N clone of M tokens in K places`.
    const re = /^code-duplication: type-(\d+) clone of (\d+) tokens in (\d+) places$/;
    const match = re.exec(top.message);
    expect(match).not.toBeNull();
    if (match === null) return;
    expect(Number.parseInt(match[1] ?? '0', 10)).toBe(top.cloneType);
    expect(Number.parseInt(match[3] ?? '0', 10)).toBe(top.occurrences.length);
    expect(top.severity).toBe('warn');
  });

  it('no duplicates → no findings', () => {
    // Two files with totally disjoint identifiers — Type-1 won't fire because
    // the content differs; Type-2 may not fire either at minTokens=50 because
    // the structures are short.
    write('a.ts', 'const a = 1;\nconst b = 2;');
    write('b.ts', 'function foo() { return null; }');
    const fix = buildFixture(dir, [
      { relPath: 'a.ts', source: '' },
      { relPath: 'b.ts', source: '' },
    ]);
    const rule = createCodeDuplicationRule('error');
    const findings = rule(ctx(fix, dir));
    expect(findings).toEqual([]);
  });

  it('determinism: two runs produce identical JSON output', () => {
    write('a.ts', sharedBlock());
    write('b.ts', sharedBlock());
    const fix = buildFixture(dir, [
      { relPath: 'a.ts', source: sharedBlock() },
      { relPath: 'b.ts', source: sharedBlock() },
    ]);
    const rule = createCodeDuplicationRule('error');
    const r1 = rule(ctx(fix, dir));
    const r2 = rule(ctx(fix, dir));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('unreadable file is skipped (fail-soft)', () => {
    // Only b.ts exists on disk; a.ts is in the graph but missing from disk.
    write('b.ts', sharedBlock());
    const fix = buildFixture(dir, [
      { relPath: 'a.ts', source: '' },
      { relPath: 'b.ts', source: sharedBlock() },
    ]);
    const rule = createCodeDuplicationRule('error');
    const findings = rule(ctx(fix, dir));
    // No partner for b.ts to clone with → no findings, no throw.
    expect(findings).toEqual([]);
  });

  it('rule output range maps within the source file', () => {
    write('a.ts', sharedBlock());
    write('b.ts', sharedBlock());
    const fix = buildFixture(dir, [
      { relPath: 'a.ts', source: sharedBlock() },
      { relPath: 'b.ts', source: sharedBlock() },
    ]);
    const rule = createCodeDuplicationRule('error');
    const findings = rule(ctx(fix, dir));
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const top = findings[0];
    if (top === undefined || top.kind !== 'code-duplication') throw new Error('unexpected');
    expect(top.range).toBeDefined();
    expect(top.range?.start.byteOffset).toBeGreaterThanOrEqual(0);
    expect(top.range?.end.byteOffset).toBeGreaterThan(top.range?.start.byteOffset ?? 0);
    expect(top.range?.start.line).toBeGreaterThanOrEqual(1);
  });
});
