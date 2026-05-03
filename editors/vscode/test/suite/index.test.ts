/**
 * Suite runner stub. The Mocha glue lives inside the `@vscode/test-electron`
 * harness; this file declares the test cases to run.
 *
 * Tests:
 *   - extension activates
 *   - LSP client starts within 5 seconds
 *   - diagnostics are published for a TS file with a known issue
 *   - code-action provider returns at least one action
 *   - tree views are registered
 */
export const TEST_SUITE_NAME = 'fugazi-vscode-smoke';

export const TESTS_DESCRIPTORS = [
  { id: 'activate', timeoutMs: 5000 },
  { id: 'lsp-starts', timeoutMs: 10000 },
  { id: 'publishes-diagnostics', timeoutMs: 10000 },
  { id: 'code-action-available', timeoutMs: 5000 },
  { id: 'tree-views-registered', timeoutMs: 2000 },
] as const;
