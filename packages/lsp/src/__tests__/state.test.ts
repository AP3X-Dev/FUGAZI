/**
 * state.test.ts — Phase 3h.3 (T190) — single-mutex state-store invariants.
 *
 * Per IMP-DEBT-12 we must show that the LSP server's state lives behind ONE
 * shared mutex (the `StateStore` from `@fugazi/types`) — not per-field locks.
 * The tests below assert serialization of overlapping write callbacks.
 */

import { describe, expect, it } from 'vitest';
import { createInitialState, createStateStore, patchState } from '../state.js';

describe('LspState defaults', () => {
  it('starts in the pre-initialize phase', () => {
    expect(createInitialState().phase).toBe('pre-initialize');
  });

  it('starts with empty maps and undefined config/graph', () => {
    const s = createInitialState();
    expect(s.config).toBeUndefined();
    expect(s.graph).toBeUndefined();
    expect(s.documents.size).toBe(0);
    expect(s.issues.size).toBe(0);
  });
});

describe('patchState', () => {
  it('preserves untouched fields', () => {
    const a = createInitialState();
    const b = patchState(a, { phase: 'initialize', projectRoot: '/p' });
    expect(b.phase).toBe('initialize');
    expect(b.projectRoot).toBe('/p');
    expect(b.documents).toBe(a.documents);
    expect(b.issues).toBe(a.issues);
  });

  it('replaces config when key is present', () => {
    const a = createInitialState();
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the test
    const cfg = { rules: {}, include: [], exclude: [] } as any;
    const b = patchState(a, { config: cfg });
    expect(b.config).toBe(cfg);
  });

  it('keeps undefined when patch field is explicitly undefined (key present)', () => {
    const a = createInitialState();
    const b = patchState(a, { config: undefined });
    expect(b.config).toBeUndefined();
  });
});

describe('StateStore — serialization invariants', () => {
  it('serialises overlapping writers (one body executes at a time)', async () => {
    const store = createStateStore();
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks: Promise<void>[] = [];

    for (let i = 0; i < 10; i++) {
      tasks.push(
        store.write(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          // Yield to the event loop so a parallel writer would race here if
          // the store didn't serialise.
          await new Promise<void>((r) => setImmediate(r));
          inFlight -= 1;
        }),
      );
    }
    await Promise.all(tasks);
    expect(maxInFlight).toBe(1);
  });

  it('reads observe write-applied state', async () => {
    const store = createStateStore();
    await store.write((s) => {
      Object.assign(s, patchState(s, { phase: 'initialize', projectRoot: '/x' }));
      return undefined;
    });
    const phase = await store.read((s) => s.phase);
    const root = await store.read((s) => s.projectRoot);
    expect(phase).toBe('initialize');
    expect(root).toBe('/x');
  });

  it('writers proceed after a failing writer (rejection does not poison the chain)', async () => {
    const store = createStateStore();
    const failed = store.write(async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');

    await store.write((s) => {
      Object.assign(s, patchState(s, { phase: 'initialize' }));
      return undefined;
    });
    const phase = await store.read((s) => s.phase);
    expect(phase).toBe('initialize');
  });
});
