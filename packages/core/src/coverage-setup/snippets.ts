/**
 * coverage-setup/snippets.ts — Phase 3h.6 (T215-T217) — per-runner config.
 *
 * One snippet per supported runner. Each snippet is informational — the
 * wizard prints it; the user copies it into their config. v1 does NOT write
 * to user config files (per the 3h.6 deferral list).
 *
 * Output path is the conventional location for each runner; tests pin these
 * to keep the surface stable.
 */

import { join } from 'node:path';
import type { SupportedRunner } from './detect.js';

export interface RunnerSnippet {
  readonly runner: SupportedRunner;
  /** Path the user is expected to write the snippet into. */
  readonly configPath: string;
  /** The verbatim snippet body, without leading indentation. */
  readonly snippet: string;
}

/** Build the snippets for the given runners, scoped to `projectRoot`. */
export function buildSnippets(
  projectRoot: string,
  runners: readonly SupportedRunner[],
): readonly RunnerSnippet[] {
  const out: RunnerSnippet[] = [];
  for (const runner of runners) {
    out.push(snippetFor(projectRoot, runner));
  }
  return Object.freeze(out) as readonly RunnerSnippet[];
}

function snippetFor(projectRoot: string, runner: SupportedRunner): RunnerSnippet {
  switch (runner) {
    case 'vitest':
      return Object.freeze({
        runner,
        configPath: join(projectRoot, 'vitest.config.ts'),
        snippet: VITEST_SNIPPET,
      }) satisfies RunnerSnippet;
    case 'jest':
      return Object.freeze({
        runner,
        configPath: join(projectRoot, 'jest.config.js'),
        snippet: JEST_SNIPPET,
      }) satisfies RunnerSnippet;
    case 'playwright':
      return Object.freeze({
        runner,
        configPath: join(projectRoot, 'playwright.config.ts'),
        snippet: PLAYWRIGHT_SNIPPET,
      }) satisfies RunnerSnippet;
    case 'pytest':
      // Phase 4e T366: pytest's coverage story is `pytest-cov`. The snippet
      // shows the install + invocation; the conventional config home is
      // `pyproject.toml` (table `[tool.coverage.run]`).
      return Object.freeze({
        runner,
        configPath: join(projectRoot, 'pyproject.toml'),
        snippet: PYTEST_SNIPPET,
      }) satisfies RunnerSnippet;
  }
}

const VITEST_SNIPPET = `// Add to vitest.config.ts:
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: './.fugazi-coverage',
    },
  },
});
`;

const JEST_SNIPPET = `// Add to jest.config.js (or .ts):
module.exports = {
  coverageProvider: 'v8',
  coverageReporters: ['json'],
  coverageDirectory: './.fugazi-coverage',
};
`;

const PYTEST_SNIPPET = `# Install pytest-cov:
#   pip install pytest-cov
#
# Run tests with JSON coverage output (Fugazi's runtime layer parses the
# coverage.json shape via Istanbul-equivalent normalisation):
#
#   pytest --cov=. --cov-report=json:./.fugazi-coverage/coverage.json --cov-report=term
#
# Add to pyproject.toml:
[tool.coverage.run]
branch = true
data_file = "./.fugazi-coverage/.coverage"

[tool.coverage.report]
show_missing = true

[tool.coverage.json]
output = "./.fugazi-coverage/coverage.json"
`;

const PLAYWRIGHT_SNIPPET = `// Playwright doesn't expose V8 coverage directly via config — wire it
// per-test by attaching to the page CDP session and dumping
// Profiler.takePreciseCoverage() to ./.fugazi-coverage at the end of the run.
//
// Example fixture (TypeScript):
//
//   import { test as base } from '@playwright/test';
//   import { writeFile } from 'node:fs/promises';
//   import { mkdir } from 'node:fs/promises';
//
//   export const test = base.extend({
//     page: async ({ page }, use, testInfo) => {
//       const session = await page.context().newCDPSession(page);
//       await session.send('Profiler.enable');
//       await session.send('Profiler.startPreciseCoverage', {
//         callCount: true,
//         detailed: true,
//       });
//       await use(page);
//       const { result } = await session.send('Profiler.takePreciseCoverage');
//       await mkdir('./.fugazi-coverage', { recursive: true });
//       await writeFile(
//         \`./.fugazi-coverage/\${testInfo.title}.json\`,
//         JSON.stringify({ result }),
//       );
//     },
//   });
`;
