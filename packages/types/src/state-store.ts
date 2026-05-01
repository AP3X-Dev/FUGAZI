/**
 * Single-writer / multi-reader async state store.
 *
 * Replaces the original Rust `Arc<RwLock<S>>` pattern (per IMP-DEBT-12 / FR-J4)
 * with a promise-chain protocol — no third-party lock library.
 *
 * Protocol invariants:
 *   - A `read()` first awaits any pending writer (`#chain`), then increments
 *     `#activeReaders` and runs its callback. Multiple reads share the same
 *     `#chain` snapshot, so they run concurrently with each other.
 *   - A `write()` enqueues onto `#chain`. When dequeued it waits for the
 *     reader counter to drain to zero, then runs exclusively. The chain is
 *     fully serial across writers; only one writer body executes at a time.
 *   - On callback throw, locks are released in `finally`. The next operation
 *     proceeds — no deadlock.
 *
 * Reader-drain notification: when a writer finds `activeReaders > 0`, it
 * lazily creates a `#drainPromise` (and stores its resolver in
 * `#resolveDrain`). Each reader, on its way out, calls the resolver if it
 * was the last active reader. This is a one-shot signal — no polling, no
 * busy-wait, no `setTimeout` loop.
 *
 * Memory: `#chain` is overwritten on each `write()` so prior chain links are
 * unreferenced and eligible for GC once their `then` callback fires. The
 * chain depth never grows unboundedly.
 */

export class StateStore<S> {
  #state: S;
  #activeReaders = 0;
  // Serial writer chain. We swap in the rejection-swallowing variant so a
  // failing writer does not poison subsequent ones.
  #chain: Promise<void> = Promise.resolve();
  // Reader-drain one-shot. Created lazily when a writer needs to wait for
  // active readers to finish; resolved by the last reader on its way out.
  #drainPromise: Promise<void> | null = null;
  #resolveDrain: (() => void) | null = null;

  constructor(initial: S) {
    this.#state = initial;
  }

  /**
   * Run `fn` against the current state with shared (reader) access.
   * Concurrent with other readers; blocked by an in-flight writer.
   */
  async read<R>(fn: (s: Readonly<S>) => R | Promise<R>): Promise<R> {
    // Snapshot the chain so we wait for the currently-pending writer (if any),
    // but new writers queued AFTER us still see our reader-counter increment.
    const pending = this.#chain;
    await pending;
    this.#activeReaders += 1;
    try {
      return await fn(this.#state as Readonly<S>);
    } finally {
      this.#activeReaders -= 1;
      if (this.#activeReaders === 0 && this.#resolveDrain !== null) {
        const resolve = this.#resolveDrain;
        this.#drainPromise = null;
        this.#resolveDrain = null;
        resolve();
      }
    }
  }

  /**
   * Run `fn` against the current state with exclusive (writer) access.
   * Queued onto an internal serial chain; runs only after every prior
   * writer has completed and every active reader has drained.
   */
  write<R>(fn: (s: S) => R | Promise<R>): Promise<R> {
    const run = async (): Promise<R> => {
      // Wait for active readers to drain, if any.
      if (this.#activeReaders > 0) {
        if (this.#drainPromise === null) {
          this.#drainPromise = new Promise<void>((resolve) => {
            this.#resolveDrain = resolve;
          });
        }
        await this.#drainPromise;
      }
      return fn(this.#state);
    };

    // Tie this op to the existing chain so writers serialize.
    const next: Promise<R> = this.#chain.then(run);
    // Advance the chain. Swallow rejection so a failing writer does not
    // poison subsequent writers (they need to wait for it, not inherit it).
    this.#chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Convenience: read-only snapshot of the current state. */
  async snapshot(): Promise<Readonly<S>> {
    return this.read((s) => s);
  }
}
