/**
 * cycles.ts — Phase 3d.4 (T097) — re-export-subgraph cycle detection.
 *
 * `detectReexportCycles(graph)` runs Tarjan's strongly-connected-components
 * algorithm over the SUBGRAPH consisting of re-export edges only (resolvable,
 * non-root, originating from an `Inventory.Import` with `kind: 'reexport'`).
 * Each strongly-connected component of size ≥ 2 (or a self-loop SCC of size 1
 * whose node has a self-edge) is a cycle.
 *
 * Why iterative Tarjan
 * --------------------
 *
 *   Recursive Tarjan blows the JS call stack on real-world barrel chains
 *   (Vue's `runtime-core` is 30+ deep on its own). The iterative form
 *   maintains an explicit `callStack` of `(node, iterIdx)` frames and
 *   simulates the recursion. The ordering is identical to the textbook
 *   version — node indices, lowlinks, and SCC composition match.
 *
 * Determinism (NFR-1 / SC-15)
 * ---------------------------
 *
 *   - Nodes are visited in FileId-ascending order.
 *   - For each node, outgoing re-export edges are visited in target-FileId
 *     order. (This affects WHICH SCC root each node lands at when there are
 *     ties, but the COMPOSITION of each SCC is invariant under traversal
 *     order — that property is what makes Tarjan deterministic.)
 *   - Each emitted cycle's `fileIds` array is sorted by FileId ascending.
 *   - The output cycle list is sorted by the lowest FileId in each cycle.
 *
 * Cycles do NOT halt propagation — they are emitted as info-level diagnostics
 * and the fixed-point engine keeps iterating until either convergence or the
 * iteration cap. See `./propagate.ts`.
 */

import { type FileId, compareFileIds } from '@fugazi/types';
import type { Graph } from '../types.js';
import { isReExportEdge } from './propagate.js';

/**
 * A cycle is a non-trivial strongly-connected component over the re-export
 * subgraph. The fileIds are the SCC's members, sorted ascending.
 */
export type Cycle = readonly FileId[];

/**
 * Run Tarjan's iterative SCC over the re-export subgraph. Returns every
 * non-trivial SCC. A trivial SCC (single node with no self-loop) is excluded.
 */
export function detectReexportCycles(graph: Graph): readonly Cycle[] {
  // Build the adjacency list filtered to re-export edges. Keys are FileIds
  // visited in numeric ascending order; values are sorted target lists.
  const reExportAdj = buildReExportAdjacency(graph);

  // Tarjan state.
  const indexOf = new Map<FileId, number>();
  const lowlink = new Map<FileId, number>();
  const onStack = new Set<FileId>();
  const sccStack: FileId[] = [];
  let nextIndex = 0;
  const cycles: FileId[][] = [];

  // Sorted entry order: nodes in ascending FileId. We do NOT iterate
  // `reExportAdj.keys()` directly because nodes may be reachable as targets
  // without having outgoing edges; cover those too.
  const allNodes = collectAllReachableNodes(reExportAdj);
  const sortedNodes = [...allNodes].sort(compareFileIds);

  for (const root of sortedNodes) {
    if (indexOf.has(root)) continue;
    // Iterative DFS with an explicit frame stack.
    const callStack: { readonly node: FileId; nextChildIdx: number }[] = [];
    indexOf.set(root, nextIndex);
    lowlink.set(root, nextIndex);
    nextIndex += 1;
    sccStack.push(root);
    onStack.add(root);
    callStack.push({ node: root, nextChildIdx: 0 });

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      if (frame === undefined) break;
      const adj = reExportAdj.get(frame.node) ?? [];
      if (frame.nextChildIdx < adj.length) {
        const child = adj[frame.nextChildIdx];
        frame.nextChildIdx += 1;
        if (child === undefined) continue;
        if (!indexOf.has(child)) {
          indexOf.set(child, nextIndex);
          lowlink.set(child, nextIndex);
          nextIndex += 1;
          sccStack.push(child);
          onStack.add(child);
          callStack.push({ node: child, nextChildIdx: 0 });
        } else if (onStack.has(child)) {
          // Back edge — update lowlink with child's index.
          const childIndex = indexOf.get(child);
          const currentLow = lowlink.get(frame.node);
          if (childIndex !== undefined && currentLow !== undefined) {
            if (childIndex < currentLow) {
              lowlink.set(frame.node, childIndex);
            }
          }
        }
      } else {
        // All children visited — close out frame. Propagate lowlink up.
        const myLow = lowlink.get(frame.node);
        const myIdx = indexOf.get(frame.node);
        if (myLow !== undefined && myIdx !== undefined && myLow === myIdx) {
          // Root of an SCC — pop until frame.node.
          const component: FileId[] = [];
          let popped: FileId | undefined;
          do {
            popped = sccStack.pop();
            if (popped === undefined) break;
            onStack.delete(popped);
            component.push(popped);
          } while (popped !== frame.node);
          // Determine if this SCC is a cycle.
          // Size ≥ 2 → always a cycle.
          // Size 1 → only a cycle if the node has a self-loop in the
          // re-export subgraph.
          if (component.length >= 2) {
            cycles.push(component.sort(compareFileIds));
          } else if (component.length === 1) {
            const only = component[0];
            if (only !== undefined && hasSelfLoop(only, reExportAdj)) {
              cycles.push([only]);
            }
          }
        }
        callStack.pop();
        // Propagate this frame's lowlink to its parent.
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1];
          if (parent !== undefined) {
            const parentLow = lowlink.get(parent.node);
            const myLow2 = lowlink.get(frame.node);
            if (parentLow !== undefined && myLow2 !== undefined && myLow2 < parentLow) {
              lowlink.set(parent.node, myLow2);
            }
          }
        }
      }
    }
  }

  // Sort cycle list by its lowest FileId for deterministic emission.
  cycles.sort((a, b) => {
    const aMin = a[0];
    const bMin = b[0];
    if (aMin === undefined && bMin === undefined) return 0;
    if (aMin === undefined) return -1;
    if (bMin === undefined) return 1;
    return compareFileIds(aMin, bMin);
  });

  return Object.freeze(cycles.map((c) => Object.freeze(c.slice())));
}

/**
 * Build the re-export-only adjacency list. Targets are sorted ascending so
 * Tarjan visits children deterministically.
 */
function buildReExportAdjacency(graph: Graph): ReadonlyMap<FileId, readonly FileId[]> {
  // Group edges by source.
  const buckets = new Map<FileId, FileId[]>();
  for (const edge of graph.edges) {
    if (!isReExportEdge(edge, graph)) continue;
    const list = buckets.get(edge.from);
    if (list === undefined) {
      buckets.set(edge.from, [edge.to]);
    } else {
      list.push(edge.to);
    }
  }
  // Sort each target list ascending and de-duplicate.
  const sorted = new Map<FileId, readonly FileId[]>();
  // Walk source FileIds in ascending order so Map insertion is deterministic.
  const sources = [...buckets.keys()].sort(compareFileIds);
  for (const from of sources) {
    const raw = buckets.get(from);
    if (raw === undefined) continue;
    const dedup = [...new Set(raw)].sort(compareFileIds);
    sorted.set(from, dedup);
  }
  return sorted;
}

/**
 * Collect every node reachable in the re-export subgraph — i.e., every node
 * that is either a source or a target of a re-export edge. We visit these in
 * Tarjan order so an isolated target node still gets indexed.
 */
function collectAllReachableNodes(
  adj: ReadonlyMap<FileId, readonly FileId[]>,
): ReadonlySet<FileId> {
  const all = new Set<FileId>();
  for (const [from, targets] of adj) {
    all.add(from);
    for (const t of targets) all.add(t);
  }
  return all;
}

/**
 * Returns `true` when `node` has a re-export edge to itself.
 */
function hasSelfLoop(node: FileId, adj: ReadonlyMap<FileId, readonly FileId[]>): boolean {
  const targets = adj.get(node);
  if (targets === undefined) return false;
  for (const t of targets) {
    if (t === node) return true;
  }
  return false;
}
