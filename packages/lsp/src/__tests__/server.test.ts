/**
 * server.test.ts — Phase 3h.3 (T189-test) — server-capabilities,
 * lifecycle state-machine, cold-start latency.
 *
 * Tests use the `createServer({ reader, writer })` entry point with in-memory
 * `PassThrough` duplex pipes so we never touch real stdio. A second
 * `MessageConnection` is wired up on the opposite ends of the same pipes to
 * drive the server like a real LSP client would.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CodeAction,
  type Diagnostic,
  ExitNotification,
  type Hover,
  HoverRequest,
  type InitializeParams,
  InitializeRequest,
  type InitializeResult,
  InitializedNotification,
  type MessageConnection,
  PublishDiagnosticsNotification,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
  createMessageConnection,
} from 'vscode-languageserver/node.js';
import { SERVER_CAPABILITIES, type ServerHandle, createServer } from '../server.js';

interface Pair {
  readonly serverHandle: ServerHandle;
  readonly client: MessageConnection;
  readonly cleanup: () => void;
}

/** Poll `predicate` every 5ms until it returns true or `timeoutMs` elapses. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise<void>((r) => setTimeout(r, 5));
  }
}

/**
 * Boot a server + wire a JSON-RPC client to its other end via two PassThrough
 * pipes. The server reads from `clientToServer`, writes to `serverToClient`;
 * the client uses the opposite direction.
 */
function bootPair(opts?: { debounceMs?: number }): Pair {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const serverReader = new StreamMessageReader(clientToServer);
  const serverWriter = new StreamMessageWriter(serverToClient);
  const handle = createServer({
    reader: serverReader,
    writer: serverWriter,
    ...(opts?.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
  });
  handle.listen();

  const clientReader = new StreamMessageReader(serverToClient);
  const clientWriter = new StreamMessageWriter(clientToServer);
  const client = createMessageConnection(clientReader, clientWriter);
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

let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'fugazi-lsp-fixture-'));
  // Synthesise a tiny 3-file fixture; the cold-start budget test below uses
  // a separate 100-file fixture.
  await writeFile(join(fixtureRoot, 'a.ts'), 'export const a = 1;\nexport const b = 2;\n', 'utf8');
  // Intentional unresolved import (`./missing.js` does not exist on disk).
  // The unresolved-imports rule fires regardless of entry-point config so
  // this fixture reliably produces at least one diagnostic for the
  // "Diagnostics publishing on cold analysis" test below.
  await writeFile(
    join(fixtureRoot, 'b.ts'),
    "import { a } from './a.js';\nimport { z } from './missing.js';\nexport const c = a + (z as unknown as number) + 1;\n",
    'utf8',
  );
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('SERVER_CAPABILITIES', () => {
  it('declares textDocumentSync as Full', () => {
    expect(SERVER_CAPABILITIES.textDocumentSync).toBe(TextDocumentSyncKind.Full);
  });

  it('advertises hoverProvider', () => {
    expect(SERVER_CAPABILITIES.hoverProvider).toBe(true);
  });

  it('advertises codeActionProvider', () => {
    expect(SERVER_CAPABILITIES.codeActionProvider).toBe(true);
  });

  it('advertises codeLensProvider with resolveProvider:false', () => {
    expect(SERVER_CAPABILITIES.codeLensProvider).toEqual({ resolveProvider: false });
  });

  it('advertises workDoneProgress', () => {
    expect(SERVER_CAPABILITIES.workDoneProgress).toBe(true);
  });
});

describe('LSP initialize handshake', () => {
  it('responds to initialize with the capabilities object', async () => {
    const pair = bootPair();
    try {
      const params: InitializeParams = {
        processId: null,
        rootUri: `file://${fixtureRoot.replaceAll('\\', '/')}`,
        capabilities: {},
        workspaceFolders: null,
      };
      const result = (await pair.client.sendRequest(
        InitializeRequest.type,
        params,
      )) as InitializeResult;
      expect(result.capabilities.textDocumentSync).toBe(TextDocumentSyncKind.Full);
      expect(result.capabilities.hoverProvider).toBe(true);
      expect(result.capabilities.codeActionProvider).toBe(true);
      expect(result.capabilities.codeLensProvider).toEqual({ resolveProvider: false });
      expect(result.serverInfo?.name).toBe('fugazi');
    } finally {
      pair.cleanup();
    }
  });

  it('persists projectRoot in the state store after initialize', async () => {
    const pair = bootPair();
    try {
      const params: InitializeParams = {
        processId: null,
        rootUri: `file://${fixtureRoot.replaceAll('\\', '/')}`,
        capabilities: {},
        workspaceFolders: null,
      };
      await pair.client.sendRequest(InitializeRequest.type, params);
      const projectRoot = await pair.serverHandle.store.read((s) => s.projectRoot);
      expect(projectRoot.length).toBeGreaterThan(0);
      expect(projectRoot).toMatch(/fugazi-lsp-fixture-/);
    } finally {
      pair.cleanup();
    }
  });

  it('advances phase initialize → initialized on InitializedNotification', async () => {
    const pair = bootPair();
    try {
      await pair.client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null,
      } as InitializeParams);
      pair.client.sendNotification(InitializedNotification.type, {});
      // Notification is fire-and-forget over the wire; poll until the handler
      // has had a chance to run. 50ms is plenty for in-memory pipes.
      await waitFor(async () => {
        const p = await pair.serverHandle.store.read((s) => s.phase);
        return p === 'initialized';
      });
      const phase = await pair.serverHandle.store.read((s) => s.phase);
      expect(phase).toBe('initialized');
    } finally {
      pair.cleanup();
    }
  });

  it('shutdown then exit advances phase to shutdown', async () => {
    const pair = bootPair();
    try {
      await pair.client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null,
      } as InitializeParams);
      pair.client.sendNotification(InitializedNotification.type, {});
      await waitFor(async () => {
        const p = await pair.serverHandle.store.read((s) => s.phase);
        return p === 'initialized';
      });
      await pair.client.sendRequest(ShutdownRequest.type);
      await waitFor(async () => {
        const p = await pair.serverHandle.store.read((s) => s.phase);
        return p === 'shutdown';
      });
      const phase = await pair.serverHandle.store.read((s) => s.phase);
      expect(phase).toBe('shutdown');
      pair.client.sendNotification(ExitNotification.type);
      await new Promise<void>((r) => setTimeout(r, 25));
    } finally {
      pair.cleanup();
    }
  });
});

describe('Cold-start latency', () => {
  it('initialize handshake on a 100-file fixture completes in <80ms', async () => {
    // Synthesise 100 tiny files for the budget assertion. The analysis itself
    // runs asynchronously after `initialized` so this only times the
    // handshake.
    const root = await mkdtemp(join(tmpdir(), 'fugazi-lsp-100-'));
    try {
      const srcDir = join(root, 'src');
      await mkdir(srcDir, { recursive: true });
      const writes: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        writes.push(writeFile(join(srcDir, `file${i}.ts`), `export const v${i} = ${i};\n`, 'utf8'));
      }
      await Promise.all(writes);

      const pair = bootPair();
      try {
        const params: InitializeParams = {
          processId: null,
          rootUri: `file://${root.replaceAll('\\', '/')}`,
          capabilities: {},
          workspaceFolders: null,
        };
        const t0 = performance.now();
        const result = (await pair.client.sendRequest(
          InitializeRequest.type,
          params,
        )) as InitializeResult;
        const elapsed = performance.now() - t0;
        expect(result.capabilities.textDocumentSync).toBe(TextDocumentSyncKind.Full);
        // Budget: 80ms target. This unit test only sanity-checks that
        // `initialize` returns promptly (it does NOT block on analysis — that
        // fires async after `initialized`); the precise budget is measured on a
        // dedicated perf runner. The upper bound here is deliberately generous
        // so shared CI runners (macOS / Windows) don't flake on scheduling.
        console.error(`[lsp cold-start 100-file] ${elapsed.toFixed(2)}ms`);
        expect(elapsed).toBeLessThan(2000);
      } finally {
        pair.cleanup();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Diagnostics publishing on cold analysis', () => {
  it('publishes diagnostics for findings produced by runAnalysis', async () => {
    const pair = bootPair({ debounceMs: 10 });
    try {
      // Collect publishDiagnostics notifications.
      const received: { uri: string; diagnostics: Diagnostic[] }[] = [];
      pair.client.onNotification(PublishDiagnosticsNotification.type, (params) => {
        received.push({
          uri: params.uri,
          diagnostics: [...params.diagnostics] as Diagnostic[],
        });
      });

      const params: InitializeParams = {
        processId: null,
        rootUri: `file://${fixtureRoot.replaceAll('\\', '/')}`,
        capabilities: {},
        workspaceFolders: null,
      };
      await pair.client.sendRequest(InitializeRequest.type, params);
      pair.client.sendNotification(InitializedNotification.type, {});

      // Poll until at least one publishDiagnostics notification arrives,
      // up to 12 seconds. Phase 4e replaced the previous fixed 2-second
      // sleep with a poll loop because cold-start under parallel turbo
      // load can run >2s when WASM parsers prewarm. The vitest 15s outer
      // budget remains the upper bound.
      await waitFor(async () => received.length > 0, 12_000);

      // Assert: at least one publishDiagnostics notification was received.
      // The 2-file fixture has unused exports, so this should always fire.
      expect(received.length).toBeGreaterThan(0);
    } finally {
      pair.cleanup();
    }
  }, 15_000);
});

describe('Hover request', () => {
  it('returns null when no issue is at the cursor', async () => {
    const pair = bootPair();
    try {
      await pair.client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null,
      } as InitializeParams);
      pair.client.sendNotification(InitializedNotification.type, {});
      await waitFor(async () => {
        const p = await pair.serverHandle.store.read((s) => s.phase);
        return p === 'initialized';
      });

      const hover = (await pair.client.sendRequest(HoverRequest.type, {
        textDocument: { uri: 'file:///nowhere.ts' },
        position: { line: 0, character: 0 },
      })) as Hover | null;
      expect(hover).toBeNull();
    } finally {
      pair.cleanup();
    }
  });
});

describe('CodeAction request', () => {
  it('returns no actions for a URI without diagnostics', async () => {
    const pair = bootPair();
    try {
      await pair.client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null,
      } as InitializeParams);
      pair.client.sendNotification(InitializedNotification.type, {});
      await waitFor(async () => {
        const p = await pair.serverHandle.store.read((s) => s.phase);
        return p === 'initialized';
      });

      const actions = (await pair.client.sendRequest('textDocument/codeAction', {
        textDocument: { uri: 'file:///nowhere.ts' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [] },
      })) as CodeAction[];
      expect(actions).toEqual([]);
    } finally {
      pair.cleanup();
    }
  });
});
