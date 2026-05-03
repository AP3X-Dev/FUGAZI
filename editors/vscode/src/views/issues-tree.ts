/**
 * Issues tree view — populated from VS Code's per-URI diagnostic list, which
 * is itself populated by the LSP `publishDiagnostics` stream.
 *
 * Two-level tree: top level = files with findings; child level = individual
 * issues (rule id, message, line). Clicking a leaf invokes
 * `fugazi.openIssue` to jump to the source range.
 */
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

export class IssuesTreeProvider implements vscode.TreeDataProvider<IssueNode> {
  private readonly emitter = new vscode.EventEmitter<IssueNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly _client: LanguageClient | undefined) {
    vscode.languages.onDidChangeDiagnostics(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(node: IssueNode): vscode.TreeItem {
    if (node.kind === 'file') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.resourceUri = node.uri;
      item.iconPath = new vscode.ThemeIcon('file');
      item.description = `${node.count} finding${node.count === 1 ? '' : 's'}`;
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(severityIcon(node.severity));
    item.description = `${node.ruleId} :: line ${node.line}`;
    item.command = {
      command: 'fugazi.openIssue',
      title: 'Open Issue',
      arguments: [node.uri, node.line],
    };
    return item;
  }

  getChildren(node?: IssueNode): IssueNode[] {
    if (!node) {
      const out: IssueNode[] = [];
      for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
        if (diagnostics.length === 0) continue;
        out.push({
          kind: 'file',
          label: uri.path.split('/').slice(-1)[0] ?? uri.toString(),
          uri,
          count: diagnostics.length,
        });
      }
      out.sort((a, b) => a.label.localeCompare(b.label));
      return out;
    }
    if (node.kind === 'file') {
      const out: IssueNode[] = [];
      for (const d of vscode.languages.getDiagnostics(node.uri)) {
        out.push({
          kind: 'issue',
          label: d.message,
          uri: node.uri,
          ruleId: typeof d.code === 'object' ? d.code.value.toString() : String(d.code ?? ''),
          line: d.range.start.line + 1,
          severity: d.severity ?? vscode.DiagnosticSeverity.Information,
        });
      }
      out.sort((a, b) => (a.line === b.line ? 0 : a.line < b.line ? -1 : 1));
      return out;
    }
    return [];
  }
}

type IssueNode =
  | { kind: 'file'; label: string; uri: vscode.Uri; count: number }
  | {
      kind: 'issue';
      label: string;
      uri: vscode.Uri;
      ruleId: string;
      line: number;
      severity: vscode.DiagnosticSeverity;
    };

function severityIcon(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    default:
      return 'circle-outline';
  }
}
