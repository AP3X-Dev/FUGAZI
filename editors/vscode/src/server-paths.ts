/**
 * Resolves the bundled LSP server entry point.
 *
 * The build step copies the LSP package's `dist/` output into
 * `editors/vscode/server/`, plus a thin `fugazi-lsp.js` launcher. At runtime
 * we resolve it from the extension's installation directory.
 */
import * as path from 'node:path';

export function resolveServerEntry(extensionPath: string): string {
  return path.join(extensionPath, 'server', 'fugazi-lsp.js');
}
