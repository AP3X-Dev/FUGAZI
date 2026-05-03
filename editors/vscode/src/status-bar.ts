/**
 * Status bar item driven by the LSP diagnostics stream.
 *
 * Aggregates diagnostics across all open URIs and renders a pass/fail glyph
 * (`$(check)` / `$(error)`) plus a finding count. Updates are debounced to
 * 200ms so that rapid bursts of `publishDiagnostics` from the LSP do not
 * cause flicker.
 */
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

const DEBOUNCE_MS = 200;

export interface StatusBarHandle extends vscode.Disposable {
  refresh(): void;
}

export function createStatusBar(_client: LanguageClient | undefined): StatusBarHandle {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'fugazi.runAnalysis';
  item.tooltip = 'Fugazi: click to re-run analysis';
  item.show();

  let pending: ReturnType<typeof setTimeout> | undefined;

  function recompute(): void {
    let total = 0;
    let errors = 0;
    for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
      for (const d of diagnostics) {
        total++;
        if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
      }
    }
    if (total === 0) {
      item.text = '$(check) Fugazi: 0';
    } else if (errors > 0) {
      item.text = `$(error) Fugazi: ${total}`;
    } else {
      item.text = `$(warning) Fugazi: ${total}`;
    }
  }

  function refresh(): void {
    if (pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      recompute();
    }, DEBOUNCE_MS);
  }

  const sub = vscode.languages.onDidChangeDiagnostics(() => refresh());
  recompute();

  return {
    refresh,
    dispose() {
      if (pending) clearTimeout(pending);
      sub.dispose();
      item.dispose();
    },
  };
}
