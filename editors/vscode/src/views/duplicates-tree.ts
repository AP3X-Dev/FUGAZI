/**
 * Duplicates tree view — populated from a custom LSP request:
 * `fugazi/listClones`, which returns clone families (groups of identical or
 * near-identical code blocks).
 *
 * Two-level tree: top level = clone family (id + similarity), child level =
 * individual clone instance (file + range).
 */
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

interface CloneInstance {
  uri: string;
  startLine: number;
  endLine: number;
}

interface CloneFamily {
  id: string;
  similarity: number;
  instances: CloneInstance[];
}

interface ListClonesResponse {
  families: CloneFamily[];
}

export class DuplicatesTreeProvider implements vscode.TreeDataProvider<DupNode> {
  private readonly emitter = new vscode.EventEmitter<DupNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private cache: CloneFamily[] = [];

  constructor(private readonly client: LanguageClient | undefined) {}

  refresh(): void {
    void this.reload();
  }

  private async reload(): Promise<void> {
    if (!this.client) return;
    try {
      const resp = (await this.client.sendRequest('fugazi/listClones', {})) as ListClonesResponse;
      this.cache = resp?.families ?? [];
    } catch {
      this.cache = [];
    }
    this.emitter.fire(undefined);
  }

  getTreeItem(node: DupNode): vscode.TreeItem {
    if (node.kind === 'family') {
      const item = new vscode.TreeItem(
        `Family ${node.familyId}`,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = `similarity ${node.similarity.toFixed(2)} :: ${node.size} instances`;
      item.iconPath = new vscode.ThemeIcon('files');
      return item;
    }
    const filename = node.uri.path.split('/').slice(-1)[0] ?? node.uri.toString();
    const item = new vscode.TreeItem(filename, vscode.TreeItemCollapsibleState.None);
    item.description = `lines ${node.startLine}-${node.endLine}`;
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.command = {
      command: 'fugazi.openIssue',
      title: 'Open Clone',
      arguments: [node.uri, node.startLine],
    };
    return item;
  }

  getChildren(node?: DupNode): DupNode[] {
    if (!node) {
      return this.cache.map((f) => ({
        kind: 'family',
        familyId: f.id,
        similarity: f.similarity,
        size: f.instances.length,
      }));
    }
    if (node.kind === 'family') {
      const family = this.cache.find((f) => f.id === node.familyId);
      if (!family) return [];
      return family.instances.map((inst) => ({
        kind: 'instance',
        uri: vscode.Uri.parse(inst.uri),
        startLine: inst.startLine,
        endLine: inst.endLine,
      }));
    }
    return [];
  }
}

type DupNode =
  | { kind: 'family'; familyId: string; similarity: number; size: number }
  | { kind: 'instance'; uri: vscode.Uri; startLine: number; endLine: number };
