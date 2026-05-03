/**
 * Bundle the VS Code extension and copy the LSP server into place.
 *
 * Two phases:
 *   1. Mirror `packages/lsp/dist/**` into `editors/vscode/server/` and emit
 *      a thin `server/fugazi-lsp.js` launcher (so the bundled extension can
 *      `require()` the server entry without depending on the workspace
 *      layout).
 *   2. Run tsup over `src/extension.ts`, target Node 18, format CJS, output
 *      to `dist/extension.js`.
 *
 * Cross-platform: relies only on `node:fs` + `node:path` plus `tsup`'s JS
 * API. Runs equally under Bun and Node.
 */
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as tsupBuild } from 'tsup';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyLspServer(): Promise<void> {
  const lspDist = resolve(REPO_ROOT, 'packages', 'lsp', 'dist');
  const serverDir = resolve(HERE, 'server');

  if (!(await exists(lspDist))) {
    throw new Error(
      `LSP dist not found at ${lspDist}. Run 'bun run build' from the repo root first.`,
    );
  }

  await rm(serverDir, { recursive: true, force: true });
  await mkdir(serverDir, { recursive: true });
  await cp(lspDist, join(serverDir, 'lsp'), { recursive: true });

  // Also vendor the runtime dependencies the LSP needs at runtime so that
  // when the extension is installed the LSP can resolve them. We copy from
  // node_modules at build time. For v1.0 we ship only the LSP dist and
  // expect the user's npm install to provide the language-server runtime.
  const launcher = `#!/usr/bin/env node
// Bundled launcher for the Fugazi LSP server.
// Resolves the LSP entry from the sibling 'lsp/' directory.
import('./lsp/index.js').then((m) => m.start());
`;
  await writeFile(join(serverDir, 'fugazi-lsp.js'), launcher, 'utf8');
}

async function bundleExtension(): Promise<void> {
  await tsupBuild({
    entry: { extension: resolve(HERE, 'src/extension.ts') },
    outDir: resolve(HERE, 'dist'),
    format: ['cjs'],
    target: 'node18',
    sourcemap: true,
    clean: true,
    dts: false,
    bundle: true,
    external: ['vscode'],
    platform: 'node',
    splitting: false,
    minify: false,
  });
}

async function main(): Promise<void> {
  await copyLspServer();
  await bundleExtension();
  // Sanity: the bundle file should exist.
  const out = resolve(HERE, 'dist', 'extension.cjs');
  const out2 = resolve(HERE, 'dist', 'extension.js');
  if (!(await exists(out)) && !(await exists(out2))) {
    throw new Error('extension bundle not produced');
  }
  // Optionally print bundle size to stderr.
  const filename = (await exists(out)) ? out : out2;
  const st = await stat(filename);
  process.stderr.write(`fugazi-vscode bundle: ${filename} (${st.size} bytes)\n`);

  // List server contents for verification.
  const serverDir = resolve(HERE, 'server');
  if (await exists(serverDir)) {
    const entries = await readdir(serverDir);
    process.stderr.write(`fugazi-vscode server/: ${entries.join(', ')}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`build.ts failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
