/**
 * debouncer.test.ts — Phase 3h.6 (T205) — coalescing debouncer.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDebouncer } from '../watch/debouncer.js';

describe('createDebouncer', () => {
  it('coalesces three pushes into one fire', async () => {
    vi.useFakeTimers();
    try {
      const fired: ReadonlySet<string>[] = [];
      const d = createDebouncer(100, (paths) => fired.push(paths));
      d.push('a');
      d.push('b');
      d.push('c');
      expect(fired.length).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(fired.length).toBe(1);
      expect([...(fired[0] ?? new Set())]).toEqual(['a', 'b', 'c']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the quiet window on every new push', async () => {
    vi.useFakeTimers();
    try {
      const fired: ReadonlySet<string>[] = [];
      const d = createDebouncer(100, (paths) => fired.push(paths));
      d.push('a');
      await vi.advanceTimersByTimeAsync(50);
      d.push('b');
      await vi.advanceTimersByTimeAsync(50);
      // Should not have fired yet — second push reset the timer.
      expect(fired.length).toBe(0);
      await vi.advanceTimersByTimeAsync(50);
      expect(fired.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() cancels a pending fire', async () => {
    vi.useFakeTimers();
    try {
      const fired: ReadonlySet<string>[] = [];
      const d = createDebouncer(100, (paths) => fired.push(paths));
      d.push('a');
      d.cancel();
      await vi.advanceTimersByTimeAsync(200);
      expect(fired.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('armed is true while a timer is pending', () => {
    vi.useFakeTimers();
    try {
      const d = createDebouncer(100, () => {});
      expect(d.armed).toBe(false);
      d.push('a');
      expect(d.armed).toBe(true);
      d.cancel();
      expect(d.armed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the pending set after firing', async () => {
    vi.useFakeTimers();
    try {
      const fired: ReadonlySet<string>[] = [];
      const d = createDebouncer(100, (paths) => fired.push(paths));
      d.push('a');
      await vi.advanceTimersByTimeAsync(100);
      d.push('b');
      await vi.advanceTimersByTimeAsync(100);
      expect(fired.length).toBe(2);
      expect([...(fired[0] ?? new Set())]).toEqual(['a']);
      expect([...(fired[1] ?? new Set())]).toEqual(['b']);
    } finally {
      vi.useRealTimers();
    }
  });
});
