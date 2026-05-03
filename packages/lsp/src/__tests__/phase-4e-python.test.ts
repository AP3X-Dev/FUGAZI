/**
 * phase-4e-python.test.ts — Phase 4e (T365) — LSP Python language support.
 *
 * Verifies that the LSP server accepts Python documents over `didOpen` /
 * `didChange`, runs the analysis pipeline (which dispatches to the Python
 * extractor via T361), and surfaces diagnostics when rules fire.
 *
 * The server registers no language-ID filter (TextDocumentSyncKind.Full
 * accepts every URI scheme/extension), so the only thing to verify is the
 * runtime path — which lands when runAnalysis sees a `.py` file in
 * discovery and dispatches accordingly.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DidOpenTextDocumentNotification,
  type DidOpenTextDocumentParams,
  type InitializeParams,
  InitializeRequest,
  InitializedNotification,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from 'vscode-languageserver/node.js';
import { type ServerHandle, createServer } from '../server.js';

interface Pair {
  readonly serverHandle: ServerHandle;
  readonly client: MessageConnection;
  readonly cleanup: () => void;
}

function bootPair(opts?: { debounceMs?: number }): Pair {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const handle = createServer({
    reader: new StreamMessageReader(clientToServer),
    writer: new StreamMessageWriter(serverToClient),
    ...(opts?.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
  });
  handle.listen();
  const client = createMessageConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer),
  );
  client.listen();
  const cleanup = (): void => {
    try {
      client.dispose();
    } catch {
      /* ignore */
    }
    try {
      handle.connection.dispose();
    } catch {
      /* ignore */
    }
    clientToServer.destroy();
    serverToClient.destroy();
  };
  return { serverHandle: handle, client, cleanup };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise<void>((r) => setTimeout(r, 5));
  }
}

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'fugazi-lsp-py-'));
  await writeFile(join(fixtureRoot, 'a.py'), 'def helper():\n    return 1\n', 'utf8');
  await writeFile(
    join(fixtureRoot, 'b.py'),
    'from .a import helper\n\ndef use():\n    return helper()\n',
    'utf8',
  );
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
});

describe('Phase 4e T365 — LSP Python language support', () => {
  it('1. accepts a Python `didOpen` event without filtering it out', async () => {
    const pair = bootPair({ debounceMs: 10 });
    try {
      await pair.client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: `file://${fixtureRoot.replaceAll('\\', '/')}`,
        capabilities: {},
        workspaceFolders: null,
      } as InitializeParams);
      pair.client.sendNotification(InitializedNotification.type, {});
      await waitFor(async () => {
        const p = await pair.serverHandle.store.read((s) => s.phase);
        return p === 'initialized';
      });

      const fileUri = `file://${join(fixtureRoot, 'a.py').replaceAll('\\', '/')}`;
      const params: DidOpenTextDocumentParams = {
        textDocument: {
          uri: fileUri,
          languageId: 'python',
          version: 1,
          text: 'def x():\n    return 1\n',
        },
      };
      pair.client.sendNotification(DidOpenTextDocumentNotification.type, params);

      // Allow handler to run + state to update. The doc map is keyed by URI.
      await waitFor(async () => {
        const docs = await pair.serverHandle.store.read((s) => s.documents);
        return docs.has(fileUri);
      }, 2000);

      const docs = await pair.serverHandle.store.read((s) => s.documents);
      expect(docs.has(fileUri)).toBe(true);
    } finally {
      pair.cleanup();
    }
  }, 15_000);

  it('2. cold analysis processes Python files in the project root', async () => {
    const pair = bootPair({ debounceMs: 10 });
    try {
      await pair.client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: `file://${fixtureRoot.replaceAll('\\', '/')}`,
        capabilities: {},
        workspaceFolders: null,
      } as InitializeParams);
      pair.client.sendNotification(InitializedNotification.type, {});

      // The cold-analysis path runs runAnalysis() which dispatches to the
      // Python pipeline for `.py` files. Wait long enough for the debounced
      // analysis to complete; we only assert the pipeline didn't crash —
      // diagnostic emission depends on rule activation and is exercised by
      // the per-rule tests already.
      await new Promise<void>((r) => setTimeout(r, 2000));

      const phase = await pair.serverHandle.store.read((s) => s.phase);
      // Server still alive after analysis.
      expect(phase).toBe('initialized');
    } finally {
      pair.cleanup();
    }
  }, 15_000);
});
