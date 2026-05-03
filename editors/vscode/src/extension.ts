/**
 * Fugazi VS Code extension entry point.
 *
 * Activates on TS/JS file open and on the `fugazi.runAnalysis` command. Boots
 * the bundled LSP client (server lives at `server/fugazi-lsp.js` next to this
 * file once the extension is packaged), wires up the three tree views, the
 * status bar, and the code-lens click → code-action shortcut.
 */
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

import { createCodeLensBridge } from './code-lens.js';
import { startLanguageClient } from './lsp-client.js';
import { createStatusBar } from './status-bar.js';
import { DuplicatesTreeProvider } from './views/duplicates-tree.js';
import { HealthTreeProvider } from './views/health-tree.js';
import { IssuesTreeProvider } from './views/issues-tree.js';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = await startLanguageClient(context);

  const issues = new IssuesTreeProvider(client);
  const duplicates = new DuplicatesTreeProvider(client);
  const health = new HealthTreeProvider(client);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fugaziIssues', issues),
    vscode.window.registerTreeDataProvider('fugaziDuplicates', duplicates),
    vscode.window.registerTreeDataProvider('fugaziHealth', health),
  );

  const statusBar = createStatusBar(client);
  context.subscriptions.push(statusBar);

  const codeLensBridge = createCodeLensBridge();
  context.subscriptions.push(codeLensBridge);

  context.subscriptions.push(
    vscode.commands.registerCommand('fugazi.runAnalysis', async () => {
      await client?.sendRequest('workspace/executeCommand', {
        command: 'fugazi.runAnalysis',
      });
      issues.refresh();
      duplicates.refresh();
      health.refresh();
    }),
    vscode.commands.registerCommand('fugazi.openIssue', async (uri: vscode.Uri, line: number) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      const position = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }),
    vscode.commands.registerCommand('fugazi.toggleHotPaths', async () => {
      await client?.sendRequest('workspace/executeCommand', {
        command: 'fugazi.toggleHotPaths',
      });
    }),
  );
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
