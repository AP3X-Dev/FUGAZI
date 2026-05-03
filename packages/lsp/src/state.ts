/**
 * state.ts — Phase 3h.3 (T190) — single async-mutex state store.
 *
 * Per IMP-DEBT-12 the LSP server keeps every piece of mutable state behind ONE
 * single-class state store. This file wraps the shared `StateStore<S>` from
 * `@fugazi/types` with the LSP-specific shape:
 *
 *   - `projectRoot`     project root the analyser is bound to.
 *   - `config`          resolved `FugaziConfig`.
 *   - `graph`           the most recent module graph; `undefined` until the
 *                       first cold-analysis completes.
 *   - `issues`          the most recent diagnostic stream, keyed by URI.
 *   - `documents`       open-document text snapshot keyed by URI.
 *
 * Updates flow through `store.write(s => { … })`. Reads flow through
 * `store.read(s => …)`. The store is shared across every connection handler
 * (initialise, didOpen, didChange, didClose, codeAction, codeLens, hover,
 * shutdown). No second mutex anywhere.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Graph } from '@fugazi/graph';
import { type DiscriminatedIssue, StateStore } from '@fugazi/types';

export type LifecyclePhase = 'pre-initialize' | 'initialize' | 'initialized' | 'shutdown' | 'exit';

/** The single LSP-server state shape. Every field is replaceable; nothing is mutated in-place. */
export interface LspState {
  /** Connection lifecycle phase — see protocol state-machine. */
  readonly phase: LifecyclePhase;
  /** Project root the server analyses. Set by `initialize`. */
  readonly projectRoot: string;
  /** Resolved Fugazi config; defaults applied. */
  readonly config: FugaziConfig | undefined;
  /** Most recent module graph (warm cache for incremental analyses). */
  readonly graph: Graph | undefined;
  /** Per-URI diagnostic stream from the most recent analysis. */
  readonly issues: ReadonlyMap<string, readonly DiscriminatedIssue[]>;
  /** Per-URI text snapshot, kept in sync with `didOpen` / `didChange` / `didClose`. */
  readonly documents: ReadonlyMap<string, string>;
}

export function createInitialState(): LspState {
  return {
    phase: 'pre-initialize',
    projectRoot: '',
    config: undefined,
    graph: undefined,
    issues: new Map(),
    documents: new Map(),
  };
}

/** Construct the single-mutex state store seeded with the pre-initialize state. */
export function createStateStore(): StateStore<LspState> {
  return new StateStore<LspState>(createInitialState());
}

/** Convenience helper — replace fields immutably without losing exactOptionalProps shape. */
export function patchState(prev: LspState, patch: Partial<LspState>): LspState {
  return {
    phase: patch.phase ?? prev.phase,
    projectRoot: patch.projectRoot ?? prev.projectRoot,
    config: 'config' in patch ? patch.config : prev.config,
    graph: 'graph' in patch ? patch.graph : prev.graph,
    issues: patch.issues ?? prev.issues,
    documents: patch.documents ?? prev.documents,
  };
}
