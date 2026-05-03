/**
 * watch/sigint.ts — Phase 3h.6 (T205) — two-step SIGINT contract.
 *
 * First Ctrl-C: print the verbatim cancel-line to stderr and call `onAbort()`
 * (aborts the in-flight analysis). Second Ctrl-C within 2s exits 130.
 *
 * Per D2: tests assert the verbatim message byte-for-byte.
 */

/** Verbatim message printed on the first Ctrl-C. */
export const FIRST_CTRL_C_MESSAGE = 'Cancelled in-flight analysis. Press Ctrl-C again to exit.\n';

export interface SigintHandlerOptions {
  readonly stderr: NodeJS.WritableStream;
  readonly onAbort: () => void;
  readonly onSecondInterrupt: () => void;
  /** Max ms between first and second SIGINT before the count resets. */
  readonly windowMs?: number;
}

export interface SigintHandlerHandle {
  /** Detach the handler from `process` (idempotent). */
  detach(): void;
  /** Force the handler back into "no first-press received" state — used in tests. */
  reset(): void;
  /** True after the first SIGINT has been observed. */
  readonly armed: boolean;
}

const DEFAULT_WINDOW_MS = 2000;

/**
 * Install a `SIGINT` listener implementing the two-step contract. Returns a
 * detach handle so the watcher can clean up on shutdown.
 */
export function installSigintHandler(options: SigintHandlerOptions): SigintHandlerHandle {
  const window = options.windowMs ?? DEFAULT_WINDOW_MS;
  let armedAt: number | null = null;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const onSigint = (): void => {
    const now = Date.now();
    if (armedAt !== null && now - armedAt <= window) {
      // Second press inside the window — exit.
      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = null;
      armedAt = null;
      options.onSecondInterrupt();
      return;
    }
    // First press (or expired window).
    options.stderr.write(FIRST_CTRL_C_MESSAGE);
    armedAt = now;
    options.onAbort();
    if (resetTimer !== null) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      armedAt = null;
      resetTimer = null;
    }, window);
  };

  process.on('SIGINT', onSigint);

  return {
    detach() {
      process.removeListener('SIGINT', onSigint);
      if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
    },
    reset() {
      armedAt = null;
      if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
    },
    get armed() {
      return armedAt !== null;
    },
  };
}
