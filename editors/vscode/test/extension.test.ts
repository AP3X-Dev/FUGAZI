/**
 * VS Code extension smoke test entry.
 *
 * This file is wired up against `@vscode/test-electron` for production CI.
 * If the test runner is not available locally (e.g. headless Chromium /
 * VS Code download is blocked), the manual smoke instructions in
 * `test/manual-smoke.md` cover the same ground.
 */
import * as path from 'node:path';

async function main(): Promise<void> {
  // Lazy import so missing optional dep does not crash typecheck.
  const mod = await import('@vscode/test-electron').catch(() => undefined);
  if (!mod) {
    // Document the deferral and exit success.
    process.stderr.write(
      "skipping VS Code smoke tests: '@vscode/test-electron' is not installed locally.\n",
    );
    return;
  }
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  await mod.runTests({ extensionDevelopmentPath, extensionTestsPath });
}

main().catch((err) => {
  process.stderr.write(
    `extension smoke test failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
