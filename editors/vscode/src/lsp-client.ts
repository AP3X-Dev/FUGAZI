/**
 * Bundled LSP client wrapper.
 *
 * Resolves the bundled server path via `server-paths.ts` and starts a
 * `vscode-languageclient/node` LanguageClient over Node IPC. The server
 * binary is the same `bin/fugazi-lsp.js` shipped by the `fugazi` npm
 * package, copied into `editors/vscode/server/` by `build.ts`.
 */
import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

import { resolveServerEntry } from './server-paths.js';

export async function startLanguageClient(
  context: vscode.ExtensionContext,
): Promise<LanguageClient> {
  const serverEntry = resolveServerEntry(context.extensionPath);

  const serverOptions: ServerOptions = {
    run: {
      module: serverEntry,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverEntry,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const documentSelector: LanguageClientOptions['documentSelector'] = [
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'typescriptreact' },
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'javascriptreact' },
  ];

  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {
      configurationSection: 'fugazi',
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/.fugazirc.json'),
        vscode.workspace.createFileSystemWatcher('**/fugazi.config.ts'),
        vscode.workspace.createFileSystemWatcher('**/fugazi.toml'),
      ],
    },
  };

  const client = new LanguageClient(
    'fugazi',
    'Fugazi Language Server',
    serverOptions,
    clientOptions,
  );

  await client.start();
  return client;
}
