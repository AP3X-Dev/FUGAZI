/**
 * @fugazi/lsp — Phase 3h.3 (T189-T194) — public surface.
 *
 * Five LSP capabilities backed by the shared `runAnalysis()` driver:
 *   1. textDocumentSync (Full — see commit body for the v1 decision)
 *   2. publishDiagnostics (500ms per-URI debounce)
 *   3. codeActionProvider (suppression actions)
 *   4. codeLensProvider (per-file issue count)
 *   5. hoverProvider (Markdown rule reference)
 *
 * Plus workDoneProgress wiring for long analyses (IMP-OBS-04). State managed
 * inside one `StateStore<LspState>` from `@fugazi/types` (IMP-DEBT-12).
 *
 * `start()` boots the production stdio server consumed by `bin/fugazi-lsp.js`.
 * `createServer({ reader, writer })` is the test harness entry — it accepts
 * arbitrary MessageReader/Writer pairs so connections can be driven without
 * stdio.
 */

export {
  SERVER_CAPABILITIES,
  createServer,
  start,
  type CreateServerOptions,
  type ServerHandle,
} from './server.js';
export {
  DEBOUNCE_MS,
  DIAGNOSTIC_SOURCE,
  PerUriDebouncer,
  groupIssuesByFile,
  issueToDiagnostic,
  issuesToDiagnostics,
} from './diagnostics.js';
export {
  buildSuppressionActions,
  buildSuppressionActionsForRange,
} from './code-actions.js';
export { buildFileCodeLenses } from './code-lens.js';
export { RULE_EXPLANATIONS, buildHover, formatHoverMarkdown } from './hover.js';
export { makeProgressBridge, type ProgressReporter } from './progress.js';
export {
  createInitialState,
  createStateStore,
  patchState,
  type LifecyclePhase,
  type LspState,
} from './state.js';
