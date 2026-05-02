/**
 * trace.ts — Phase 3h.5 (T201) — programmatic `traceFile()` + `traceExport()`.
 *
 * Walks the reverse-import index produced by `@fugazi/graph`. Algorithm
 * mirrors the CLI's `fugazi trace` command (`packages/cli/src/commands/
 * trace.ts`): build the graph via discover + extract, BFS over reverse edges
 * from the target, and return the path-sorted importer set.
 *
 * For 3h.5 the surface is the flat reachable-set wrapped as length-1 chains
 * (consistent with the CLI output). A future expansion may emit full BFS
 * path-lists; the chain-of-chains shape was chosen so the surface doesn't
 * have to change at that point.
 *
 * The CLI duplicates this logic today; deduplicating into a shared helper is
 * a 3i clean-up — explicitly scoped out of 3h.5 per the implementation plan.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { type Inventory, buildInventory, parse } from '@fugazi/extract';
import { type FileId, type FileNode, buildGraph, buildReverseIndices } from '@fugazi/graph';
import { assignFileIds } from '@fugazi/types';
import type { TraceExportOptions, TraceFileOptions, TraceResult } from './types.js';

const RECOGNIZED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo']);

/* -------------------------------------------------------------------------- */
/* traceFile                                                                   */
/* -------------------------------------------------------------------------- */

export async function traceFile(opts: TraceFileOptions): Promise<TraceResult> {
  const targetAbs = toPosix(
    isAbsolute(opts.targetFile) ? opts.targetFile : join(opts.projectRoot, opts.targetFile),
  );
  const built = await buildProjectGraph(opts.projectRoot, opts.abortSignal);
  const targetId = built.ids.get(targetAbs);
  if (targetId === undefined) {
    return Object.freeze({ chains: Object.freeze([]), target: targetAbs }) satisfies TraceResult;
  }
  const reachable = bfsReverseFrom(built, [targetId], () => true);
  return Object.freeze({
    chains: Object.freeze(reachable.map((p) => Object.freeze([p]) as readonly string[])),
    target: targetAbs,
  }) satisfies TraceResult;
}

/* -------------------------------------------------------------------------- */
/* traceExport                                                                 */
/* -------------------------------------------------------------------------- */

export async function traceExport(opts: TraceExportOptions): Promise<TraceResult> {
  const built = await buildProjectGraph(opts.projectRoot, opts.abortSignal);

  // Find every FileId whose inventory contains a usage of `exportName`. These
  // are the "seeds" for the reverse-walk: callers asking "who reaches this
  // export" want the union of importers of every source that uses the name.
  const seeds: FileId[] = [];
  for (const node of built.graph.files.values()) {
    if (importsNamed(node.inventory, opts.exportName)) {
      seeds.push(node.id);
    }
  }
  seeds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const reachable = bfsReverseFrom(built, seeds, (sourceNode) =>
    importsNamed(sourceNode.inventory, opts.exportName),
  );
  return Object.freeze({
    chains: Object.freeze(reachable.map((p) => Object.freeze([p]) as readonly string[])),
    target: opts.exportName,
  }) satisfies TraceResult;
}

/* -------------------------------------------------------------------------- */
/* Internal: graph build + reverse BFS                                         */
/* -------------------------------------------------------------------------- */

interface BuiltProjectGraph {
  readonly graph: ReturnType<typeof buildGraph>;
  readonly reverse: ReturnType<typeof buildReverseIndices>;
  readonly ids: ReadonlyMap<string, FileId>;
}

async function buildProjectGraph(
  projectRoot: string,
  signal: AbortSignal | undefined,
): Promise<BuiltProjectGraph> {
  const files = await discoverFiles(projectRoot);
  if (signal?.aborted) throw new Error('traceFile aborted');
  const ids = assignFileIds(files);
  const fileNodes: FileNode[] = [];
  for (const path of files) {
    if (signal?.aborted) throw new Error('traceFile aborted');
    const id = ids.get(path);
    if (id === undefined) continue;
    const inventory = await extractInventory(path);
    fileNodes.push({ id, path, inventory });
  }
  const graph = buildGraph({ files: fileNodes, resolverContext: { projectRoot } });
  const reverse = buildReverseIndices(graph);
  return { graph, reverse, ids };
}

function bfsReverseFrom(
  built: BuiltProjectGraph,
  seeds: readonly FileId[],
  filter: (sourceNode: FileNode) => boolean,
): readonly string[] {
  const reachable = new Set<string>();
  const queue: FileId[] = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    const incoming = built.reverse.edgesByTarget.get(current);
    if (incoming === undefined) continue;
    for (const edge of incoming) {
      const sourceNode = built.graph.files.get(edge.from);
      if (sourceNode === undefined) continue;
      if (!filter(sourceNode)) continue;
      if (reachable.has(sourceNode.path)) continue;
      reachable.add(sourceNode.path);
      queue.push(edge.from);
    }
  }
  return [...reachable].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function importsNamed(inventory: Inventory, name: string): boolean {
  for (const usage of inventory.usages) {
    if (usage.name === name) return true;
  }
  return false;
}

async function extractInventory(path: string): Promise<Inventory> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    return emptyInventory();
  }
  let result: Awaited<ReturnType<typeof parse>>;
  try {
    result = await parse(source, { filename: path, lang: langForExtension(path) });
  } catch {
    return emptyInventory();
  }
  if (result.program === null) return emptyInventory();
  return buildInventory(result.program);
}

function emptyInventory(): Inventory {
  return Object.freeze({
    declarations: Object.freeze([]),
    imports: Object.freeze([]),
    usages: Object.freeze([]),
  });
}

function toPosix(p: string): string {
  return sep === '\\' ? p.replaceAll('\\', '/') : p;
}

function langForExtension(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')) return 'ts';
  return 'js';
}

async function discoverFiles(projectRoot: string): Promise<readonly string[]> {
  const out: string[] = [];
  await walkDir(projectRoot, out);
  return out
    .map((p) => toPosix(p))
    .filter((p) => existsSync(p))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function walkDir(dir: string, out: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot === -1) continue;
      const ext = entry.name.slice(dot);
      if (RECOGNIZED_EXTENSIONS.includes(ext)) out.push(full);
    }
  }
}
