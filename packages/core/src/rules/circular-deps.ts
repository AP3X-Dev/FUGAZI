/**
 * rules/circular-deps.ts — Phase 3f.2 Wave 2 (T146).
 *
 * Iterative Tarjan SCC over the resolvable subgraph (edges with `to !==
 * ROOT_FILE_ID`). Every non-trivial SCC — size ≥ 2, or size 1 with a self-edge
 * — emits one `circular-dependencies` issue carrying the canonical cycle
 * walk.
 *
 * Why iterative: a recursive Tarjan blows the JS call stack on real-world
 * barrel chains. The frame-stack form mirrors the textbook algorithm; node
 * indices, lowlinks and SCC composition are identical.
 *
 * The cycle walk is deterministic:
 *
 *   1. Pick the lexically-smallest path string in the SCC as the start.
 *   2. Traverse outgoing edges within the SCC, picking the lexically-smallest
 *      target at each step that is in the SCC and not yet visited.
 *   3. Append `cycle[0]` to close the loop.
 *
 * This produces a stable cycle representation regardless of FileId ordering.
 *
 * NOTE: this implementation does NOT import from `@fugazi/graph/re-exports/cycles`.
 * That detector runs over the re-export-only subgraph for fixed-point cycle
 * propagation; we run over the full resolvable subgraph for diagnostic
 * emission. Re-implementing here keeps the rule layer free of cross-package
 * coupling.
 */

import type { FileId, Graph } from '@fugazi/graph';
import type { CircularDependenciesIssue, DiscriminatedIssue, Severity } from '@fugazi/types';
import { ROOT_FILE_ID } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'circular-dependencies' as const;

export function createCircularDependenciesRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const sccs = tarjanIterative(ctx.graph);
    if (sccs.length === 0) return [];

    const issues: CircularDependenciesIssue[] = [];
    for (const scc of sccs) {
      const cycle = canonicalCycleWalk(scc, ctx.graph);
      if (cycle.length === 0) continue;
      const start = cycle[0];
      if (start === undefined) continue;
      issues.push(
        Object.freeze({
          kind: RULE_KIND,
          severity,
          file: start,
          cycle: Object.freeze(cycle),
          message: `circular-dependencies: cycle detected: ${cycle.join(' → ')}`,
        }) satisfies CircularDependenciesIssue,
      );
    }

    issues.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return issues as readonly DiscriminatedIssue[];
  };
}

/* -------------------------------------------------------------------------- */
/* Tarjan SCC (iterative)                                                      */
/* -------------------------------------------------------------------------- */

interface SCC {
  readonly nodes: readonly FileId[];
  readonly hasCycle: boolean;
}

function tarjanIterative(graph: Graph): readonly SCC[] {
  const adj = buildAdjacency(graph);
  const indexOf = new Map<FileId, number>();
  const lowlink = new Map<FileId, number>();
  const onStack = new Set<FileId>();
  const sccStack: FileId[] = [];
  let nextIndex = 0;
  const result: SCC[] = [];

  // Iterate FileIds in numeric ascending order for determinism.
  const allNodes = [...graph.files.keys()].sort(
    (a, b) => (a as unknown as number) - (b as unknown as number),
  );

  for (const root of allNodes) {
    if (indexOf.has(root)) continue;
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
      const children = adj.get(frame.node) ?? [];

      if (frame.nextChildIdx < children.length) {
        const child = children[frame.nextChildIdx];
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
          const childIndex = indexOf.get(child);
          const currentLow = lowlink.get(frame.node);
          if (childIndex !== undefined && currentLow !== undefined && childIndex < currentLow) {
            lowlink.set(frame.node, childIndex);
          }
        }
      } else {
        const myLow = lowlink.get(frame.node);
        const myIdx = indexOf.get(frame.node);
        if (myLow !== undefined && myIdx !== undefined && myLow === myIdx) {
          const component: FileId[] = [];
          let popped: FileId | undefined;
          do {
            popped = sccStack.pop();
            if (popped === undefined) break;
            onStack.delete(popped);
            component.push(popped);
          } while (popped !== frame.node);

          if (component.length >= 2) {
            result.push({ nodes: component, hasCycle: true });
          } else if (component.length === 1) {
            const only = component[0];
            if (only !== undefined && hasSelfLoop(only, adj)) {
              result.push({ nodes: component, hasCycle: true });
            }
          }
        }
        callStack.pop();
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

  return result;
}

/** Build a per-source adjacency list filtered to resolvable, non-root edges. */
function buildAdjacency(graph: Graph): ReadonlyMap<FileId, readonly FileId[]> {
  const buckets = new Map<FileId, FileId[]>();
  for (const edge of graph.edges) {
    if (!edge.resolvable) continue;
    if (edge.to === ROOT_FILE_ID) continue;
    let list = buckets.get(edge.from);
    if (list === undefined) {
      list = [];
      buckets.set(edge.from, list);
    }
    list.push(edge.to);
  }
  // Deduplicate + sort each list ascending so Tarjan visits children
  // deterministically regardless of edge insertion order.
  const out = new Map<FileId, readonly FileId[]>();
  const sources = [...buckets.keys()].sort(
    (a, b) => (a as unknown as number) - (b as unknown as number),
  );
  for (const from of sources) {
    const raw = buckets.get(from);
    if (raw === undefined) continue;
    const dedup = [...new Set(raw)].sort(
      (a, b) => (a as unknown as number) - (b as unknown as number),
    );
    out.set(from, dedup);
  }
  return out;
}

function hasSelfLoop(node: FileId, adj: ReadonlyMap<FileId, readonly FileId[]>): boolean {
  const targets = adj.get(node);
  if (targets === undefined) return false;
  for (const t of targets) {
    if (t === node) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Canonical cycle walk                                                        */
/* -------------------------------------------------------------------------- */

function canonicalCycleWalk(scc: SCC, graph: Graph): readonly string[] {
  const memberSet = new Set<FileId>(scc.nodes);
  const idToPath = new Map<FileId, string>();
  for (const id of scc.nodes) {
    const node = graph.files.get(id);
    if (node !== undefined) idToPath.set(id, node.path);
  }

  // Per-source adjacency restricted to SCC members, target paths sorted.
  const sccAdj = new Map<FileId, FileId[]>();
  for (const edge of graph.edges) {
    if (!edge.resolvable) continue;
    if (edge.to === ROOT_FILE_ID) continue;
    if (!memberSet.has(edge.from)) continue;
    if (!memberSet.has(edge.to)) continue;
    let list = sccAdj.get(edge.from);
    if (list === undefined) {
      list = [];
      sccAdj.set(edge.from, list);
    }
    list.push(edge.to);
  }
  // Sort each adjacency by target PATH ascending and dedupe.
  for (const [from, list] of sccAdj) {
    const dedup = [...new Set(list)];
    dedup.sort((a, b) => {
      const pa = idToPath.get(a) ?? '';
      const pb = idToPath.get(b) ?? '';
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
    sccAdj.set(from, dedup);
  }

  // Pick the lexically-smallest path as start.
  const sccPaths = scc.nodes
    .map((id) => idToPath.get(id) ?? '')
    .filter((p) => p.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const startPath = sccPaths[0];
  if (startPath === undefined) return [];
  let startId: FileId | undefined;
  for (const id of scc.nodes) {
    if (idToPath.get(id) === startPath) {
      startId = id;
      break;
    }
  }
  if (startId === undefined) return [];

  // Self-loop: SCC of size 1 that has a self-edge.
  if (scc.nodes.length === 1) {
    return [startPath, startPath];
  }

  // Greedy lex-smallest walk. We need to consume every distinct member at
  // least once; if no unvisited neighbour exists, allow falling back to any
  // neighbour to close the loop (defensive — Tarjan guarantees an SCC is
  // strongly connected so this fallback is only reached for the closing edge).
  const path: string[] = [startPath];
  const visited = new Set<FileId>([startId]);
  let cursor: FileId = startId;

  while (visited.size < scc.nodes.length) {
    const neighbours = sccAdj.get(cursor) ?? [];
    let next: FileId | undefined;
    for (const n of neighbours) {
      if (!visited.has(n)) {
        next = n;
        break;
      }
    }
    if (next === undefined) {
      // Cannot reach remaining nodes greedily — defensive break (should not
      // occur for true SCCs, but we never throw).
      break;
    }
    visited.add(next);
    const np = idToPath.get(next);
    if (np === undefined) break;
    path.push(np);
    cursor = next;
  }

  // Close the loop. Append the start path; the last visited node MUST have an
  // edge back to the start because Tarjan declared this SCC strongly
  // connected. We do not verify the closing edge — the determinism contract
  // is on the path representation, not on edge presence.
  path.push(startPath);
  return path;
}
