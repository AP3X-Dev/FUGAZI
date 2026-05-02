/**
 * rules/types.ts — Phase 3f.2 Wave 1 — rule-handler contract.
 *
 * Every Fugazi rule is a pure function `RuleHandler` from a fully-assembled
 * `RuleContext` (graph + per-path FileNode index + project root + entry-points
 * + config) to a deeply-readonly array of `DiscriminatedIssue`. Handlers must:
 *
 *   - Be deterministic. The driver re-sorts the union of all rule outputs by
 *     `(file, range.start.byteOffset, kind)` before hashing, but each handler
 *     should emit in path-sorted order to keep per-rule debugging tractable.
 *   - Never mutate the input graph or any nested data. Auxiliary maps (e.g.
 *     reachability sets) are built locally per call.
 *   - Never throw on hostile input. A rule that cannot produce a finding for a
 *     malformed file should silently skip that file rather than abort the run.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { FileNode, Graph } from '@fugazi/graph';
import type { DiscriminatedIssue } from '@fugazi/types';

/**
 * `RuleContext` — the fully-assembled per-run state every rule sees.
 *
 *   - `graph`         frozen module graph from `@fugazi/graph` (3d.3).
 *   - `fileNodes`     path → FileNode index, built once in `runAnalysis` so
 *                     every rule shares one map instead of re-scanning
 *                     `graph.files` per invocation.
 *   - `projectRoot`   absolute POSIX path; rule output never includes paths
 *                     outside this root.
 *   - `entryPoints`   absolute POSIX paths of project entry points pulled from
 *                     `config.entrypoints`. Empty when the user has not
 *                     declared any — the unused-* rules early-return in that
 *                     case so the analysis surface still makes sense (without
 *                     roots, every file is unreachable, which would flag the
 *                     entire project).
 *   - `config`        the resolved FugaziConfig; rules read severity overrides
 *                     and any rule-specific options from here.
 */
export interface RuleContext {
  readonly graph: Graph;
  readonly fileNodes: ReadonlyMap<string, FileNode>;
  readonly projectRoot: string;
  readonly entryPoints: readonly string[];
  readonly config: FugaziConfig;
}

/**
 * `RuleHandler` — pure, synchronous, never-throws contract.
 *
 * Async work (e.g. reading file content) belongs in earlier phases — by the
 * time a handler runs, every input it needs is on `RuleContext`.
 */
export type RuleHandler = (ctx: RuleContext) => readonly DiscriminatedIssue[];
