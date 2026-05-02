/**
 * rules/unused-files.ts — Phase 3f.2 Wave 1 (T136).
 *
 * Single-BFS unused-file detector.
 *
 * Roots = `entryPoints` ∪ source files of every `dynamic` edge in the graph
 * (dynamic-import sources are reachable by virtue of being able to start an
 * import chain at runtime).
 *
 * Reachability follows every edge kind (`static`, `type`, `dynamic`,
 * `require`, `side-effect`, `asset`) — they are all real reachability proofs.
 * Files in `graph.files` whose path is NOT reachable from any root are
 * reported as `unused-files`, with the path emitted in path-sorted order for
 * deterministic output.
 *
 * Per IMP-PERF-07 the original Fallow Rust pipeline's three-layer fallback
 * (transitive closure, unreached files, hand-crafted heuristics) is collapsed
 * into a single BFS pass. There are no fallbacks here.
 *
 * When `entryPoints` is empty, no roots exist and the rule emits nothing
 * rather than flagging the entire project — without declared entries, a
 * project has no reachability frame of reference.
 */

import type { Edge, FileId, FileNode, Graph } from '@fugazi/graph';
import type { DiscriminatedIssue, Severity, UnusedFilesIssue } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'unused-files' as const;

/** Build the rule with the resolved severity threaded through. */
export function createUnusedFilesRule(severity: Severity): RuleHandler {
  return (ctx) => {
    if (ctx.entryPoints.length === 0) return [];

    const roots = collectRoots(ctx.graph, ctx.entryPoints, ctx.fileNodes);
    if (roots.size === 0) return [];

    const reachable = bfs(ctx.graph, roots);

    const orphanPaths: string[] = [];
    for (const node of ctx.graph.files.values()) {
      if (!reachable.has(node.id)) {
        orphanPaths.push(node.path);
      }
    }
    orphanPaths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const out: UnusedFilesIssue[] = [];
    for (const path of orphanPaths) {
      out.push(
        Object.freeze({
          kind: RULE_KIND,
          severity,
          file: path,
          path,
          message: `unused-files: ${path} is not reachable from any entry point`,
        }) satisfies UnusedFilesIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}

/** Collect the root FileId set: entry-point ids + every dynamic-import source. */
function collectRoots(
  graph: Graph,
  entryPoints: readonly string[],
  fileNodes: ReadonlyMap<string, FileNode>,
): Set<FileId> {
  const roots = new Set<FileId>();
  for (const entry of entryPoints) {
    const node = fileNodes.get(entry);
    if (node !== undefined) roots.add(node.id);
  }
  for (const edge of graph.edges) {
    if (edge.kind === 'dynamic') {
      // The source file of any dynamic import is reachable: at runtime
      // something kicked it off, even if the static graph doesn't see how.
      roots.add(edge.from);
    }
  }
  return roots;
}

/** BFS over the graph; returns the set of FileIds reachable from `roots`. */
function bfs(graph: Graph, roots: ReadonlySet<FileId>): Set<FileId> {
  const visited = new Set<FileId>(roots);
  const queue: FileId[] = [...roots];

  // Build per-source adjacency once. graph.edges is sorted by (from, to, kind,
  // specifier), so iterating and grouping is O(E) and deterministic.
  const outgoing = new Map<FileId, Edge[]>();
  for (const edge of graph.edges) {
    let bucket = outgoing.get(edge.from);
    if (bucket === undefined) {
      bucket = [];
      outgoing.set(edge.from, bucket);
    }
    bucket.push(edge);
  }

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const edges = outgoing.get(id);
    if (edges === undefined) continue;
    for (const edge of edges) {
      if (!edge.resolvable) continue;
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push(edge.to);
    }
  }
  return visited;
}
