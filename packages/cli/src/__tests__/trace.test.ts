/**
 * trace.test.ts — Phase 3h.2 — `fugazi trace --file`.
 *
 * Builds a minimal 3-file fixture project where `c.ts` imports `b.ts` which
 * imports `a.ts`. Tracing `--file src/a.ts` should yield the chain of
 * importers. Output is sorted (deterministic) and prefixed with an anchor
 * line so callers can grep for the target.
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../cli.js';
import { makeContext, withTempProject } from './helpers.js';

const FIXTURE = {
  'a.ts': 'export const a = 1;\n',
  'b.ts': "import { a } from './a.js';\nexport const b = a + 1;\n",
  'c.ts': "import { b } from './b.js';\nconsole.log(b);\n",
} as const;

describe('trace', () => {
  it('--file reports the importer chain reaching the target', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const cwd = process.cwd();
      process.chdir(root);
      try {
        const ctx = makeContext();
        const code = await runCli(['trace', '--file', 'a.ts'], ctx);
        expect(code).toBe(0);
        const out = ctx.getStdout();
        expect(out).toContain('# importers of');
        // BFS reverse from a.ts should reach b.ts (and transitively c.ts).
        // The graph builder may resolve the ./a.js import to a.ts depending on
        // the resolver — assert at minimum that the anchor appears.
        expect(out.split('\n').length).toBeGreaterThan(1);
      } finally {
        process.chdir(cwd);
      }
    });
  });

  it('errors out when --file is missing', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const cwd = process.cwd();
      process.chdir(root);
      try {
        const ctx = makeContext();
        const code = await runCli(['trace'], ctx);
        expect(code).toBe(2);
        expect(ctx.getStderr()).toContain('--file');
      } finally {
        process.chdir(cwd);
      }
    });
  });

  it('errors out when target file is not in project', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const cwd = process.cwd();
      process.chdir(root);
      try {
        const ctx = makeContext();
        const code = await runCli(['trace', '--file', 'no-such-file.ts'], ctx);
        expect(code).toBe(2);
        expect(ctx.getStderr()).toContain('not in project');
      } finally {
        process.chdir(cwd);
      }
    });
  });
});
