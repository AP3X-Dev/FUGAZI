/**
 * watch.test.ts — Phase 3h.6 (T205) — `runWatch` orchestrator.
 *
 * Drives the watch entrypoint with an injected `subscribe` so the test
 * controls when filesystem events fire and an injected `runAnalysisFn` so
 * we can observe how often analysis runs.
 */
import { Writable } from 'node:stream';
import type { RunAnalysisOptions, RunAnalysisResult } from '@fugazi/core';
import { describe, expect, it } from 'vitest';
import { runWatch } from '../watch/index.js';
import { withTempProject } from './helpers.js';

interface SubscribeCall {
  readonly emit: (events: { path: string; type: 'create' | 'update' | 'delete' }[]) => void;
}

function fakeSubscribe(): {
  readonly subscribe: (
    dir: string,
    cb: (
      err: Error | null,
      events: { path: string; type: 'create' | 'update' | 'delete' }[],
    ) => unknown,
  ) => Promise<{ unsubscribe(): Promise<void> }>;
  readonly subscriptions: SubscribeCall[];
} {
  const subscriptions: SubscribeCall[] = [];
  return {
    subscribe: async (_dir, cb) => {
      const emit = (events: { path: string; type: 'create' | 'update' | 'delete' }[]): void => {
        cb(null, events);
      };
      subscriptions.push({ emit });
      return { unsubscribe: async () => {} };
    },
    subscriptions,
  };
}

function makeStream(): { stream: NodeJS.WritableStream; getOutput(): string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, getOutput: () => buf };
}

const FIXTURE = {
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': "import { a } from './a.js';\nexport const b = a + 1;\n",
  'src/c.ts': "import { b } from './b.js';\nconsole.log(b);\n",
  'package.json': '{ "name": "fixture", "version": "0.0.0" }\n',
} as const;

const EMPTY_RESULT: RunAnalysisResult = Object.freeze({
  issues: [],
  actions: [],
  metrics: {
    filesScanned: 0,
    diagnosticsByRule: {},
    elapsedMs: 0,
    cacheHitRate: 0,
    filesByLang: { ts: 0, py: 0 },
    parseErrors: { total: 0, byLang: { ts: 0, py: 0 } },
  },
  progressEvents: [],
  _meta: {
    version: '0.0.0',
    mode: 'full' as const,
    determinismHash: 'x'.repeat(64),
  },
}) as RunAnalysisResult;

describe('runWatch', () => {
  it('runs initial analysis on startup', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const stdout = makeStream();
      const stderr = makeStream();
      const fake = fakeSubscribe();
      let runs = 0;
      const fakeRunAnalysis = async (_opts: RunAnalysisOptions): Promise<RunAnalysisResult> => {
        runs += 1;
        return EMPTY_RESULT;
      };
      const handle = await runWatch({
        projectRoot: root,
        format: 'json',
        quiet: true,
        stdout: stdout.stream,
        stderr: stderr.stream,
        subscribe: fake.subscribe,
        runAnalysisFn: fakeRunAnalysis,
        debounceMs: 10,
      });
      // Initial run completed during runWatch await.
      expect(runs).toBe(1);
      await handle.stop();
      const code = await handle.exit;
      expect(code).toBe(0);
    });
  });

  it('debounces a flurry of file changes into a single re-analysis', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const stdout = makeStream();
      const stderr = makeStream();
      const fake = fakeSubscribe();
      let runs = 0;
      const fakeRunAnalysis = async (): Promise<RunAnalysisResult> => {
        runs += 1;
        return EMPTY_RESULT;
      };
      const handle = await runWatch({
        projectRoot: root,
        format: 'json',
        quiet: true,
        stdout: stdout.stream,
        stderr: stderr.stream,
        subscribe: fake.subscribe,
        runAnalysisFn: fakeRunAnalysis,
        debounceMs: 30,
      });
      const initial = runs;
      // Fire three change events in quick succession.
      const sub = fake.subscriptions[0];
      if (sub === undefined) throw new Error('no subscription');
      sub.emit([{ path: `${root}/src/a.ts`, type: 'update' }]);
      sub.emit([{ path: `${root}/src/b.ts`, type: 'update' }]);
      sub.emit([{ path: `${root}/src/c.ts`, type: 'update' }]);
      // Wait past the debounce window.
      await new Promise((r) => setTimeout(r, 80));
      expect(runs - initial).toBe(1);
      await handle.stop();
    });
  });

  it('ignores unrecognized file extensions', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const stdout = makeStream();
      const stderr = makeStream();
      const fake = fakeSubscribe();
      let runs = 0;
      const fakeRunAnalysis = async (): Promise<RunAnalysisResult> => {
        runs += 1;
        return EMPTY_RESULT;
      };
      const handle = await runWatch({
        projectRoot: root,
        format: 'json',
        quiet: true,
        stdout: stdout.stream,
        stderr: stderr.stream,
        subscribe: fake.subscribe,
        runAnalysisFn: fakeRunAnalysis,
        debounceMs: 30,
      });
      const initial = runs;
      const sub = fake.subscriptions[0];
      if (sub === undefined) throw new Error('no subscription');
      // .bin / .png — ignored.
      sub.emit([{ path: `${root}/binary.bin`, type: 'update' }]);
      sub.emit([{ path: `${root}/image.png`, type: 'update' }]);
      await new Promise((r) => setTimeout(r, 80));
      expect(runs).toBe(initial);
      await handle.stop();
    });
  });

  it('passes an AbortSignal to runAnalysis', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const stdout = makeStream();
      const stderr = makeStream();
      const fake = fakeSubscribe();
      let receivedSignal: AbortSignal | undefined;
      const fakeRunAnalysis = async (opts: RunAnalysisOptions): Promise<RunAnalysisResult> => {
        receivedSignal = opts.abortSignal;
        return EMPTY_RESULT;
      };
      const handle = await runWatch({
        projectRoot: root,
        format: 'json',
        quiet: true,
        stdout: stdout.stream,
        stderr: stderr.stream,
        subscribe: fake.subscribe,
        runAnalysisFn: fakeRunAnalysis,
        debounceMs: 10,
      });
      expect(receivedSignal).toBeDefined();
      await handle.stop();
    });
  });

  it('writes reporter output to stdout after each run', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const stdout = makeStream();
      const stderr = makeStream();
      const fake = fakeSubscribe();
      const handle = await runWatch({
        projectRoot: root,
        format: 'json',
        quiet: true,
        stdout: stdout.stream,
        stderr: stderr.stream,
        subscribe: fake.subscribe,
        runAnalysisFn: async () => EMPTY_RESULT,
        debounceMs: 10,
      });
      // Initial run wrote to stdout.
      expect(stdout.getOutput().length).toBeGreaterThan(0);
      await handle.stop();
    });
  });

  /* -- Phase 4e (T367) — Python file watching -- */

  it('Phase 4e T367: change to a .py file triggers a re-analysis', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const stdout = makeStream();
      const stderr = makeStream();
      const fake = fakeSubscribe();
      let runs = 0;
      const fakeRunAnalysis = async (): Promise<RunAnalysisResult> => {
        runs += 1;
        return EMPTY_RESULT;
      };
      const handle = await runWatch({
        projectRoot: root,
        format: 'json',
        quiet: true,
        stdout: stdout.stream,
        stderr: stderr.stream,
        subscribe: fake.subscribe,
        runAnalysisFn: fakeRunAnalysis,
        debounceMs: 30,
      });
      const initial = runs;
      const sub = fake.subscriptions[0];
      if (sub === undefined) throw new Error('no subscription');
      sub.emit([{ path: `${root}/main.py`, type: 'update' }]);
      await new Promise((r) => setTimeout(r, 80));
      expect(runs - initial).toBe(1);
      await handle.stop();
    });
  });

  it('Phase 4e T367: change to a .pyi stub triggers a re-analysis', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const stdout = makeStream();
      const stderr = makeStream();
      const fake = fakeSubscribe();
      let runs = 0;
      const fakeRunAnalysis = async (): Promise<RunAnalysisResult> => {
        runs += 1;
        return EMPTY_RESULT;
      };
      const handle = await runWatch({
        projectRoot: root,
        format: 'json',
        quiet: true,
        stdout: stdout.stream,
        stderr: stderr.stream,
        subscribe: fake.subscribe,
        runAnalysisFn: fakeRunAnalysis,
        debounceMs: 30,
      });
      const initial = runs;
      const sub = fake.subscriptions[0];
      if (sub === undefined) throw new Error('no subscription');
      sub.emit([{ path: `${root}/types.pyi`, type: 'update' }]);
      await new Promise((r) => setTimeout(r, 80));
      expect(runs - initial).toBe(1);
      await handle.stop();
    });
  });

  it('Phase 4e T367: .pyc compiled bytecode does NOT trigger a re-analysis', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const stdout = makeStream();
      const stderr = makeStream();
      const fake = fakeSubscribe();
      let runs = 0;
      const fakeRunAnalysis = async (): Promise<RunAnalysisResult> => {
        runs += 1;
        return EMPTY_RESULT;
      };
      const handle = await runWatch({
        projectRoot: root,
        format: 'json',
        quiet: true,
        stdout: stdout.stream,
        stderr: stderr.stream,
        subscribe: fake.subscribe,
        runAnalysisFn: fakeRunAnalysis,
        debounceMs: 30,
      });
      const initial = runs;
      const sub = fake.subscriptions[0];
      if (sub === undefined) throw new Error('no subscription');
      sub.emit([{ path: `${root}/main.cpython-312.pyc`, type: 'update' }]);
      sub.emit([{ path: `${root}/__pycache__/foo.pyc`, type: 'update' }]);
      await new Promise((r) => setTimeout(r, 80));
      expect(runs).toBe(initial);
      await handle.stop();
    });
  });
});
