/**
 * Code-lens bridge: the LSP supplies the lens metadata, this client wires the
 * `command` payload of each lens to a thin VS Code command (`fugazi.applyFix`)
 * which forwards to the LSP `workspace/executeCommand` endpoint.
 *
 * Click → 200ms debounce → execute the suppression / fix code action.
 */
import * as vscode from 'vscode';

const CLICK_DEBOUNCE_MS = 200;

export function createCodeLensBridge(): vscode.Disposable {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let lastInvocation: number | undefined;

  const sub = vscode.commands.registerCommand(
    'fugazi.applyFix',
    async (uri: vscode.Uri, range: vscode.Range, fixId: string) => {
      // Coalesce rapid clicks on the same lens.
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
      }, CLICK_DEBOUNCE_MS);
      lastInvocation = Date.now();

      await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, range, {
        kinds: ['quickfix'],
        only: fixId,
      });
    },
  );

  return {
    dispose() {
      if (pending) clearTimeout(pending);
      lastInvocation = undefined;
      void lastInvocation;
      sub.dispose();
    },
  };
}
