/**
 * watch/debouncer.ts — Phase 3h.6 (T205) — coalescing debouncer.
 *
 * Per IMP-MOD-06 we never pull in `lodash.debounce` or `p-debounce` for
 * something this small. The implementation collects every change path that
 * arrives within a quiet window and fires `onFire(paths)` once `delayMs`
 * milliseconds elapse with no new push. Each new push resets the timer.
 *
 * Five lines of body — anything bigger here is gold-plating.
 */

export interface CoalescingDebouncer {
  /** Push one path to the pending set; resets the quiet-window timer. */
  push(path: string): void;
  /** Cancel any pending fire (e.g. shutdown). */
  cancel(): void;
  /** True iff a timer is currently armed. */
  readonly armed: boolean;
}

export function createDebouncer(
  delayMs: number,
  onFire: (paths: ReadonlySet<string>) => void,
): CoalescingDebouncer {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    push(path) {
      pending.add(path);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        const fire = pending;
        pending = new Set();
        timer = null;
        onFire(fire);
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = new Set();
    },
    get armed() {
      return timer !== null;
    },
  };
}
