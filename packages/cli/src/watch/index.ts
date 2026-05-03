/**
 * watch/index.ts — Phase 3h.6 (T205) — `bunx fugazi watch` orchestrator.
 *
 * Pipeline:
 *   1. Run analysis once at startup; render to stdout via `selectReporter`.
 *   2. Subscribe to `@parcel/watcher` on `projectRoot` recursively, ignoring
 *      `node_modules` and `.git`.
 *   3. Each filesystem event whose path matches our recognised extension set
 *      gets pushed to a 5-line coalescing debouncer (300ms quiet window).
 *   4. Debouncer fires => abort any in-flight analysis, start a new one,
 *      render the result.
 *   5. SIGINT is two-step: first press cancels, second press (within 2s)
 *      exits 130.
 *
 * AbortController plumbing (IMP-ARCH-07): every `runAnalysis` call gets the
 * watcher-owned controller's signal. SIGINT and "new change arrived" both
 * abort via the same handle.
 *
 * The optional `<command>` argument is reserved (`bunx fugazi watch -- <cmd>`)
 * but not implemented in v1; the watcher always re-runs analysis.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AnalysisMode,
  type Reporter,
  type ReporterFormat,
  runAnalysis,
  selectReporter,
} from '@fugazi/core';
import { FugaziCoreError } from '@fugazi/types';
import parcelWatcher from '@parcel/watcher';
import { loadFugaziConfig } from '../commands/run-helpers.js';
import { type CoalescingDebouncer, createDebouncer } from './debouncer.js';
import { installSigintHandler } from './sigint.js';

const RECOGNISED_EXTENSIONS = new Set<string>([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.mdx',
  '.css',
]);

const DEFAULT_DEBOUNCE_MS = 300;
const CLI_VERSION = '0.0.0';

export interface WatchRunOptions {
  readonly projectRoot: string;
  readonly format: ReporterFormat;
  readonly quiet: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  /** Override debounce window (default 300ms). */
  readonly debounceMs?: number;
  /**
   * Used in tests — wraps `parcelWatcher.subscribe` so the test can drive
   * fake events without touching the FS. Defaults to `parcelWatcher.subscribe`.
   */
  readonly subscribe?: typeof parcelWatcher.subscribe;
  /**
   * Inject a custom `runAnalysis` for tests. Keeps the signature compatible
   * with `@fugazi/core`'s exported function.
   */
  readonly runAnalysisFn?: typeof runAnalysis;
  /** Called once a stable subscription is in place — used in tests. */
  readonly onReady?: () => void | Promise<void>;
}

export interface WatchRunHandle {
  /** Resolves when the watcher exits (SIGINT or programmatic stop). */
  readonly exit: Promise<number>;
  /** Programmatically stop the watcher. */
  stop(): Promise<void>;
}

/**
 * Run the watcher. Returns a handle whose `exit` promise resolves with the
 * intended exit code once the watcher is torn down.
 */
export async function runWatch(options: WatchRunOptions): Promise<WatchRunHandle> {
  const subscribe = options.subscribe ?? parcelWatcher.subscribe;
  const runAnalysisImpl = options.runAnalysisFn ?? runAnalysis;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const cfg = await loadFugaziConfig(options.projectRoot);

  const ignorePatterns = await loadIgnorePatterns(options.projectRoot);

  let inFlight: AbortController | null = null;
  let exitResolve: ((code: number) => void) | undefined;
  const exit = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });

  const fire = async (): Promise<void> => {
    // Abort any in-flight analysis before starting a new one.
    if (inFlight !== null) {
      inFlight.abort();
    }
    const controller = new AbortController();
    inFlight = controller;
    try {
      await runAndRender({
        projectRoot: options.projectRoot,
        format: options.format,
        quiet: options.quiet,
        stdout: options.stdout,
        stderr: options.stderr,
        signal: controller.signal,
        runAnalysisFn: runAnalysisImpl,
        config: cfg,
      });
    } catch (err) {
      // Abort propagates as FugaziCoreError(CORE_ABORTED) — silent.
      if (!isAbortError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        options.stderr.write(`watch: analysis failed: ${msg}\n`);
      }
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  };

  const debouncer: CoalescingDebouncer = createDebouncer(debounceMs, () => {
    void fire();
  });

  // Subscribe.
  let subscription: { unsubscribe(): Promise<void> } | null = null;
  try {
    subscription = await subscribe(
      options.projectRoot,
      (err, events) => {
        if (err !== null) {
          options.stderr.write(`watch: subscriber error: ${err.message}\n`);
          return;
        }
        for (const event of events) {
          if (!isWatchedPath(event.path)) continue;
          if (matchesIgnore(event.path, ignorePatterns)) continue;
          debouncer.push(event.path);
        }
      },
      { ignore: [...WATCH_IGNORE_DEFAULTS] },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    options.stderr.write(`watch: failed to start watcher: ${msg}\n`);
    if (exitResolve !== undefined) exitResolve(1);
    return {
      exit,
      async stop() {
        /* nothing to clean up */
      },
    };
  }

  // Initial run.
  await fire();
  if (options.onReady !== undefined) await options.onReady();

  const sigint = installSigintHandler({
    stderr: options.stderr,
    onAbort: () => {
      if (inFlight !== null) inFlight.abort();
    },
    onSecondInterrupt: () => {
      void teardown(130);
    },
  });

  let stopping = false;
  const teardown = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    sigint.detach();
    debouncer.cancel();
    if (inFlight !== null) inFlight.abort();
    if (subscription !== null) {
      try {
        await subscription.unsubscribe();
      } catch {
        // ignore — best effort
      }
    }
    if (exitResolve !== undefined) exitResolve(code);
  };

  return {
    exit,
    async stop() {
      await teardown(0);
    },
  };
}

/** Default ignore patterns passed to parcel-watcher. */
const WATCH_IGNORE_DEFAULTS: readonly string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/.fugazi-coverage/**',
];

async function loadIgnorePatterns(projectRoot: string): Promise<readonly string[]> {
  const candidate = join(projectRoot, '.fugaziignore');
  if (!existsSync(candidate)) return Object.freeze([]) as readonly string[];
  try {
    const content = await readFile(candidate, 'utf8');
    const out: string[] = [];
    for (const lineRaw of content.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (line.length === 0) continue;
      if (line.startsWith('#')) continue;
      out.push(line);
    }
    return Object.freeze(out) as readonly string[];
  } catch {
    return Object.freeze([]) as readonly string[];
  }
}

function isWatchedPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = path.slice(dot).toLowerCase();
  return RECOGNISED_EXTENSIONS.has(ext);
}

function matchesIgnore(path: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (path.includes(pattern)) return true;
  }
  return false;
}

interface RunAndRenderOptions {
  readonly projectRoot: string;
  readonly format: ReporterFormat;
  readonly quiet: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly signal: AbortSignal;
  readonly runAnalysisFn: typeof runAnalysis;
  readonly config: Awaited<ReturnType<typeof loadFugaziConfig>>;
}

async function runAndRender(opts: RunAndRenderOptions): Promise<void> {
  const reporter: Reporter = selectReporter(opts.format);
  const mode: AnalysisMode = 'full';
  reporter.begin({
    mode,
    version: CLI_VERSION,
    projectRoot: opts.projectRoot,
  });

  const result = await opts.runAnalysisFn({
    kind: mode,
    config: opts.config,
    projectRoot: opts.projectRoot,
    abortSignal: opts.signal,
    onProgress: (event) => {
      if (!opts.quiet) reporter.emitProgress(event);
    },
  });

  for (const issue of result.issues) reporter.emit(issue);
  const payload = reporter.end();
  if (typeof payload === 'string') {
    opts.stdout.write(payload);
    if (!payload.endsWith('\n')) opts.stdout.write('\n');
  } else {
    opts.stdout.write(payload);
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof FugaziCoreError && err.code === 'CORE_ABORTED') return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
    return true;
  }
  return false;
}
