/**
 * progress.test.ts — Phase 3f.1 (T133) acceptance suite.
 *
 * Covers the `ProgressEmitter` contract:
 *
 *   1. All 11 event kinds emit in the expected canonical order.
 *   2. Each event carries a monotonic seq starting at 0.
 *   3. A throwing onProgress callback does NOT abort emission; the failure is
 *      captured via globalWarnOnce and emission continues.
 *   4. Events are deterministic in order for identical input.
 *   5. Multiple listeners (one CLI, one LSP) both receive the same sequence.
 *   6. preBuiltGraph mode (driver-side): events still emitted, with zero
 *      counts where applicable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressEmitter } from '../progress.js';
import { runAnalysis } from '../run-analysis.js';
import type { ProgressEvent, RunAnalysisOptions } from '../types.js';

function emitAllElevenKinds(emitter: ProgressEmitter): void {
  emitter.emit({ kind: 'discover.start' });
  emitter.emit({ kind: 'discover.done', fileCount: 6 });
  emitter.emit({ kind: 'extract.start', total: 6 });
  emitter.emit({ kind: 'extract.progress', n: 1, total: 6 });
  emitter.emit({ kind: 'extract.done' });
  emitter.emit({ kind: 'graph.start' });
  emitter.emit({ kind: 'graph.done', edgeCount: 5 });
  emitter.emit({ kind: 'analyze.start', ruleCount: 0 });
  emitter.emit({ kind: 'analyze.progress', rule: 'unused-files', n: 1, total: 1 });
  emitter.emit({ kind: 'analyze.done' });
  emitter.emit({ kind: 'crossref.done' });
}

describe('ProgressEmitter', () => {
  let originalConsoleError: typeof console.error;
  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('1. all 11 event kinds emit in canonical order', () => {
    const received: ProgressEvent[] = [];
    const emitter = new ProgressEmitter((event) => received.push(event));
    emitAllElevenKinds(emitter);

    const kinds = received.map((e) => e.kind);
    expect(kinds).toEqual([
      'discover.start',
      'discover.done',
      'extract.start',
      'extract.progress',
      'extract.done',
      'graph.start',
      'graph.done',
      'analyze.start',
      'analyze.progress',
      'analyze.done',
      'crossref.done',
    ]);
  });

  it('2. each event carries a monotonic seq starting at 0', () => {
    const received: ProgressEvent[] = [];
    const emitter = new ProgressEmitter((event) => received.push(event));
    emitAllElevenKinds(emitter);

    expect(received).toHaveLength(11);
    for (let i = 0; i < received.length; i++) {
      expect(received[i]?.seq).toBe(i);
    }
  });

  it('3. throwing onProgress callback does NOT abort emission', () => {
    const received: ProgressEvent[] = [];
    const failingListener = (): void => {
      throw new Error('boom');
    };
    const goodListener = (event: ProgressEvent): void => {
      received.push(event);
    };
    const emitter = new ProgressEmitter(failingListener, goodListener);

    // Should not throw.
    expect(() => {
      emitAllElevenKinds(emitter);
    }).not.toThrow();

    // Good listener still received every event.
    expect(received).toHaveLength(11);
  });

  it('4. events are deterministic in order for identical input', () => {
    const c1: ProgressEvent[] = [];
    const c2: ProgressEvent[] = [];
    const e1 = new ProgressEmitter((event) => c1.push(event));
    const e2 = new ProgressEmitter((event) => c2.push(event));
    emitAllElevenKinds(e1);
    emitAllElevenKinds(e2);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
    expect(JSON.stringify(e1.collected())).toBe(JSON.stringify(e2.collected()));
  });

  it('5. multiple listeners both receive the same event sequence', () => {
    const cli: ProgressEvent[] = [];
    const lsp: ProgressEvent[] = [];
    const emitter = new ProgressEmitter(
      (event) => cli.push(event),
      (event) => lsp.push(event),
    );
    emitAllElevenKinds(emitter);

    expect(cli).toHaveLength(11);
    expect(lsp).toHaveLength(11);
    expect(JSON.stringify(cli)).toBe(JSON.stringify(lsp));
  });

  it('6. driver preBuiltGraph mode: events still emitted with zero counts', async () => {
    // Mirrors run-analysis.test #9 but asserted at the progress-event layer.
    const events: ProgressEvent[] = [];
    const opts: RunAnalysisOptions = {
      kind: 'full',
      config: {
        rules: {},
        include: [],
        exclude: [],
        production: false,
        strict: false,
        experimentalTsPlugins: false,
      },
      projectRoot: '/abs/proj',
      onProgress: (event) => events.push(event),
      preBuiltGraph: {
        files: new Map(),
        edges: [],
        edgesByTarget: new Map(),
      },
    };
    await runAnalysis(opts);

    const discoverDone = events.find((e) => e.kind === 'discover.done');
    expect(discoverDone?.kind).toBe('discover.done');
    if (discoverDone?.kind === 'discover.done') {
      expect(discoverDone.fileCount).toBe(0);
    }
    const graphDone = events.find((e) => e.kind === 'graph.done');
    expect(graphDone?.kind).toBe('graph.done');
    if (graphDone?.kind === 'graph.done') {
      expect(graphDone.edgeCount).toBe(0);
    }
  });

  it('collected() returns a frozen snapshot in seq order', () => {
    const emitter = new ProgressEmitter();
    emitter.emit({ kind: 'discover.start' });
    emitter.emit({ kind: 'discover.done', fileCount: 2 });
    const snapshot = emitter.collected();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]?.kind).toBe('discover.start');
    expect(snapshot[1]?.kind).toBe('discover.done');
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
