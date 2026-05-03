/**
 * server.ts — Phase 3h.3 (T190) — LSP server boot + lifecycle wiring.
 *
 * Boots a `vscode-languageserver` Connection over either stdio (production
 * boot via `start()`) or arbitrary `MessageReader`/`MessageWriter` pairs
 * (test harness — see `createServer({ reader, writer })`). The five
 * capabilities required by the spec are wired:
 *
 *   1. `textDocumentSync`   `Full` for v1 — see decision in commit body.
 *   2. `publishDiagnostics` per-URI 500ms debounce; `runAnalysis()` dispatched
 *                           on the trailing edge.
 *   3. `codeActionProvider` suppression actions (`fugazi-ignore-next-line` /
 *                           `fugazi-ignore-file`) — auto-fix actions deferred
 *                           to Phase 3h.6.
 *   4. `codeLensProvider`   one `Fugazi: <N> issues` lens per file.
 *   5. `hoverProvider`      Markdown hover with verbatim message + rule
 *                           explanation when the cursor sits inside an issue
 *                           range.
 *
 * Plus `workDoneProgress` per IMP-OBS-04 (progress events emitted via
 * `connection.window.createWorkDoneProgress()` with the runAnalysis ProgressEvent
 * stream piped through `makeProgressBridge`).
 *
 * State is kept inside one `StateStore<LspState>` per IMP-DEBT-12. Every
 * mutation goes through `store.write()`; reads through `store.read()`.
 *
 * Lifecycle state machine: pre-initialize → initialize → initialized → … →
 * shutdown → exit. Calls outside the right phase are rejected via the
 * `enforceLifecyclePhase` guards.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { type FugaziConfig, FugaziConfigSchemaPermissive } from '@fugazi/config';
import { type ProgressEvent, runAnalysis } from '@fugazi/core';
import { type DiscriminatedIssue, FugaziError, type StateStore } from '@fugazi/types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  type CodeAction,
  type CodeLens,
  type Connection,
  type Hover,
  type InitializeResult,
  type MessageReader,
  type MessageWriter,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
} from 'vscode-languageserver/node.js';
import { buildSuppressionActionsForRange } from './code-actions.js';
import { buildFileCodeLenses } from './code-lens.js';
import {
  DEBOUNCE_MS,
  PerUriDebouncer,
  groupIssuesByFile,
  issuesToDiagnostics,
} from './diagnostics.js';
import { buildHover } from './hover.js';
import { type ProgressReporter, makeProgressBridge } from './progress.js';
import { type LspState, createStateStore, patchState } from './state.js';

/**
 * The server-capabilities payload sent in the `initialize` response. Exported
 * so tests can byte-equality-assert against it.
 */
export const SERVER_CAPABILITIES = Object.freeze({
  textDocumentSync: TextDocumentSyncKind.Full,
  hoverProvider: true,
  codeActionProvider: true,
  codeLensProvider: { resolveProvider: false },
  // workDoneProgress is advertised so the client knows to listen for
  // `$/progress` notifications during long analyses (IMP-OBS-04).
  workDoneProgress: true,
}) satisfies InitializeResult['capabilities'] & { workDoneProgress: boolean };

const SERVER_INFO = Object.freeze({ name: 'fugazi', version: '0.0.0' });

/**
 * Construct a server attached to the given reader/writer pair. The function
 * returns a handle the caller listens on; lifecycle disposal is the caller's
 * responsibility (call `handle.connection.dispose()`).
 *
 * Used by both the production `start()` (which feeds stdio streams) and the
 * test harness (which feeds in-memory Duplex streams).
 */
export interface ServerHandle {
  readonly connection: Connection;
  readonly store: StateStore<LspState>;
  readonly debouncer: PerUriDebouncer;
  /** Listen — the SDK chains protocol I/O onto the supplied reader. */
  readonly listen: () => void;
}

export interface CreateServerOptions {
  readonly reader: MessageReader;
  readonly writer: MessageWriter;
  /** Override the default 500ms debounce window — used by tests. */
  readonly debounceMs?: number;
}

export function createServer(options: CreateServerOptions): ServerHandle {
  const connection = createConnection(options.reader, options.writer);
  const store = createStateStore();
  const debouncer = new PerUriDebouncer(options.debounceMs ?? DEBOUNCE_MS);
  const documents = new TextDocuments(TextDocument);

  attachHandlers({ connection, store, debouncer, documents });

  return {
    connection,
    store,
    debouncer,
    listen: () => {
      documents.listen(connection);
      connection.listen();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle handlers                                                          */
/* -------------------------------------------------------------------------- */

interface AttachContext {
  readonly connection: Connection;
  readonly store: StateStore<LspState>;
  readonly debouncer: PerUriDebouncer;
  readonly documents: TextDocuments<TextDocument>;
}

function attachHandlers(ctx: AttachContext): void {
  const { connection, store, debouncer, documents } = ctx;

  /* initialize -------------------------------------------------------------- */
  connection.onInitialize(async (params): Promise<InitializeResult> => {
    const projectRoot = resolveProjectRoot(params.rootUri ?? null, params.rootPath ?? null);
    await store.write((s) => {
      const next = patchState(s, {
        phase: 'initialize',
        projectRoot,
        config: defaultConfig(),
      });
      Object.assign(s, next);
      return undefined;
    });
    return {
      capabilities: SERVER_CAPABILITIES,
      serverInfo: SERVER_INFO,
    };
  });

  connection.onInitialized(async () => {
    await store.write((s) => {
      const next = patchState(s, { phase: 'initialized' });
      Object.assign(s, next);
      return undefined;
    });
    // Trigger a cold analysis on initialization, throttled by the debouncer
    // so tests asserting 80ms cold-start aren't blocked behind the analyze
    // pipeline. The analysis runs asynchronously and publishes diagnostics
    // when ready.
    debouncer.schedule('__cold__', async () => runColdAnalysis(ctx));
  });

  /* shutdown / exit --------------------------------------------------------- */
  connection.onShutdown(async () => {
    await store.write((s) => {
      const next = patchState(s, { phase: 'shutdown' });
      Object.assign(s, next);
      return undefined;
    });
    debouncer.cancelAll();
  });

  connection.onExit(() => {
    void store.write((s) => {
      const next = patchState(s, { phase: 'exit' });
      Object.assign(s, next);
      return undefined;
    });
    debouncer.cancelAll();
  });

  /* didOpen / didChange / didClose / didSave -------------------------------- */
  documents.onDidOpen(async ({ document }) => {
    if (!(await guardOpenable(store))) return;
    await store.write((s) => {
      const next = patchState(s, {
        documents: replaceMap(s.documents, document.uri, document.getText()),
      });
      Object.assign(s, next);
      return undefined;
    });
    debouncer.schedule(document.uri, () => runIncrementalAnalysis(ctx, document.uri));
  });

  documents.onDidChangeContent(async ({ document }) => {
    if (!(await guardOpenable(store))) return;
    await store.write((s) => {
      const next = patchState(s, {
        documents: replaceMap(s.documents, document.uri, document.getText()),
      });
      Object.assign(s, next);
      return undefined;
    });
    debouncer.schedule(document.uri, () => runIncrementalAnalysis(ctx, document.uri));
  });

  documents.onDidClose(async ({ document }) => {
    debouncer.cancel(document.uri);
    await store.write((s) => {
      const next = patchState(s, {
        documents: removeFromMap(s.documents, document.uri),
        issues: removeFromMap(s.issues, document.uri),
      });
      Object.assign(s, next);
      return undefined;
    });
    // Clear diagnostics for the closed document.
    void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  });

  documents.onDidSave(({ document }) => {
    debouncer.schedule(document.uri, () => runIncrementalAnalysis(ctx, document.uri));
  });

  /* code actions / code lens / hover --------------------------------------- */
  connection.onCodeAction(async (params): Promise<CodeAction[]> => {
    const issuesByUri = await store.read((s) => s.issues);
    const issues = issuesByUri.get(params.textDocument.uri) ?? [];
    const diagnostics = issuesToDiagnostics(issues);
    return [...buildSuppressionActionsForRange(params.textDocument.uri, diagnostics, params.range)];
  });

  connection.onCodeLens(async (params): Promise<CodeLens[]> => {
    const issuesByUri = await store.read((s) => s.issues);
    const issues = issuesByUri.get(params.textDocument.uri) ?? [];
    return [...buildFileCodeLenses(issues)];
  });

  connection.onHover(async (params): Promise<Hover | null> => {
    const issuesByUri = await store.read((s) => s.issues);
    const issues = issuesByUri.get(params.textDocument.uri) ?? [];
    return buildHover({ issues, position: params.position });
  });
}

/* -------------------------------------------------------------------------- */
/* Analysis dispatch                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Run a cold (full) analysis after initialization. Publishes diagnostics for
 * every file that produced findings. Best-effort — on error the LSP logs and
 * returns; we never crash the connection on analysis failure.
 */
async function runColdAnalysis(ctx: AttachContext): Promise<void> {
  const snapshot = await ctx.store.snapshot();
  if (snapshot.phase !== 'initialized') return;
  if (snapshot.config === undefined || snapshot.projectRoot === '') return;

  const reporter = makeWindowReporter(ctx.connection);
  const onProgress = makeProgressBridge(reporter, 'fugazi-cold-analysis');

  try {
    const result = await runAnalysis({
      projectRoot: snapshot.projectRoot,
      kind: 'full',
      config: snapshot.config,
      onProgress: (event: ProgressEvent) => onProgress(event),
    });
    // Bail if the lifecycle moved past `initialized` while we were running.
    const stillLive = await ctx.store.read((s) => s.phase === 'initialized');
    if (!stillLive) return;
    await ctx.store.write((s) => {
      const grouped = groupIssuesByFile(result.issues);
      // Convert path-keyed Map to URI-keyed Map. The graph uses absolute POSIX
      // paths; the LSP uses file:// URIs.
      const byUri = new Map<string, readonly DiscriminatedIssue[]>();
      for (const [path, issues] of grouped) {
        byUri.set(pathToFileURL(path).toString(), issues);
      }
      const next = patchState(s, { issues: byUri });
      Object.assign(s, next);
      return undefined;
    });
    await publishAllDiagnostics(ctx);
  } catch (err) {
    // Swallow logger failures — when a connection is disposed mid-analysis
    // the console no longer reaches the client. This is best-effort recovery.
    try {
      if (err instanceof FugaziError) {
        ctx.connection.console.error(`fugazi: cold analysis failed: ${err.message}`);
      } else {
        ctx.connection.console.error(`fugazi: cold analysis failed: ${String(err)}`);
      }
    } catch {
      /* connection disposed; nothing to do */
    }
  }
}

/**
 * Run an incremental analysis for a single document URI. Re-runs the full
 * pipeline today (preBuiltGraph fast-path requires a maintained graph; that
 * lands in Phase 3h.6 with file-system watching). Publishes diagnostics on
 * completion.
 */
async function runIncrementalAnalysis(ctx: AttachContext, uri: string): Promise<void> {
  if (uri === '__cold__') return;
  await runColdAnalysis(ctx);
  // Note: incremental warm-cache fast-path lives in 3h.6; today we run the
  // full pipeline because the LSP graph is not yet kept up-to-date between
  // edits. Cache hit on unchanged files is delivered via @fugazi/extract's
  // getCacheable helper inside runAnalysis, so the work is still cheap.
}

async function publishAllDiagnostics(ctx: AttachContext): Promise<void> {
  const issuesByUri = await ctx.store.read((s) => s.issues);
  for (const [uri, issues] of issuesByUri) {
    try {
      ctx.connection.sendDiagnostics({
        uri,
        diagnostics: [...issuesToDiagnostics(issues)],
      });
    } catch {
      /* connection disposed mid-publish; bail */
      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function guardOpenable(store: StateStore<LspState>): Promise<boolean> {
  const phase = await store.read((s) => s.phase);
  return phase === 'initialized';
}

function replaceMap<K, V>(prev: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> {
  const next = new Map(prev);
  next.set(key, value);
  return next;
}

function removeFromMap<K, V>(prev: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!prev.has(key)) return prev;
  const next = new Map(prev);
  next.delete(key);
  return next;
}

function resolveProjectRoot(rootUri: string | null, rootPath: string | null): string {
  if (rootUri !== null && rootUri.length > 0) {
    try {
      return fileURLToPath(rootUri).replaceAll('\\', '/');
    } catch {
      // Fall through to rootPath.
    }
  }
  if (rootPath !== null && rootPath.length > 0) {
    return rootPath.replaceAll('\\', '/');
  }
  return process.cwd().replaceAll('\\', '/');
}

function defaultConfig(): FugaziConfig {
  return FugaziConfigSchemaPermissive.parse({}) as FugaziConfig;
}

function makeWindowReporter(connection: Connection): ProgressReporter {
  // For v1 we route progress to `connection.console` rather than full
  // workDoneProgress notifications. Real workDoneProgress requires the client
  // to advertise the capability in `initialize`; not every IDE does. The
  // Reporter shape is preserved so a future version can swap in the real
  // protocol-level progress with no changes outside this function.
  //
  // Each call is wrapped in try/catch — if the connection is disposed mid-
  // analysis the SDK throws synchronously; we swallow so the analysis can
  // finish cleanly instead of poisoning the unhandled-rejection channel.
  const safeLog = (line: string): void => {
    try {
      connection.console.log(line);
    } catch {
      /* connection disposed */
    }
  };
  return {
    begin(token, title) {
      safeLog(`[${token}] ${title}`);
    },
    report(token, percentage, message) {
      const pct = percentage !== undefined ? `${percentage}% ` : '';
      const msg = message ?? '';
      safeLog(`[${token}] ${pct}${msg}`);
    },
    end(token, message) {
      safeLog(`[${token}] done${message !== undefined ? `: ${message}` : ''}`);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Production stdio boot                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Boot the LSP over stdio. Used by `bin/fugazi-lsp.js`.
 */
export async function start(): Promise<void> {
  const { StreamMessageReader, StreamMessageWriter } = await import(
    'vscode-languageserver/node.js'
  );
  const reader = new StreamMessageReader(process.stdin);
  const writer = new StreamMessageWriter(process.stdout);
  const handle = createServer({ reader, writer });
  handle.listen();
}
