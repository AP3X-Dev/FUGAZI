/**
 * Health tree view — populated from `fugazi/listHealthFindings`. Shows
 * complexity hotspots, low maintainability index files, and refactor
 * candidates produced by the health analyzer.
 */
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

interface HealthFinding {
  uri: string;
  ruleId: string;
  metric: string;
  value: number;
  message: string;
  startLine: number;
}

interface ListHealthResponse {
  findings: HealthFinding[];
}

export class HealthTreeProvider implements vscode.TreeDataProvider<HealthNode> {
  private readonly emitter = new vscode.EventEmitter<HealthNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private cache: HealthFinding[] = [];

  constructor(private readonly client: LanguageClient | undefined) {}

  refresh(): void {
    void this.reload();
  }

  private async reload(): Promise<void> {
    if (!this.client) return;
    try {
      const resp = (await this.client.sendRequest(
        'fugazi/listHealthFindings',
        {},
      )) as ListHealthResponse;
      this.cache = resp?.findings ?? [];
    } catch {
      this.cache = [];
    }
    this.emitter.fire(undefined);
  }

  getTreeItem(node: HealthNode): vscode.TreeItem {
    const filename = node.uri.path.split('/').slice(-1)[0] ?? node.uri.toString();
    const item = new vscode.TreeItem(
      `${filename} :: ${node.ruleId}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${node.metric}=${node.value.toFixed(2)}`;
    item.tooltip = node.message;
    item.iconPath = new vscode.ThemeIcon('graph');
    item.command = {
      command: 'fugazi.openIssue',
      title: 'Open Health Finding',
      arguments: [node.uri, node.startLine],
    };
    return item;
  }

  getChildren(): HealthNode[] {
    return this.cache.map((f) => ({
      uri: vscode.Uri.parse(f.uri),
      ruleId: f.ruleId,
      metric: f.metric,
      value: f.value,
      message: f.message,
      startLine: f.startLine,
    }));
  }
}

interface HealthNode {
  uri: vscode.Uri;
  ruleId: string;
  metric: string;
  value: number;
  message: string;
  startLine: number;
}
