/**
 * process-cache.ts — process-singleton cache helper (per IMP-PERF-05).
 *
 * Wraps a loader so each unique key is computed once per process and cached
 * forever. Key properties:
 *   - The Map stores the Promise (not the resolved value), so concurrent callers
 *     for the same key share the in-flight promise — no double-load.
 *   - Rejected promises remain in the Map: a failure is cached as a rejected
 *     promise, so subsequent callers receive the same rejection without
 *     re-invoking the loader (mirrors fallow's git-toplevel cache, which
 *     memoizes failures to avoid hammering subprocess on a broken repo).
 *   - No time-based eviction. Lifetime is the process.
 *
 * Canonical use: `gitToplevelCache = processCache((cwd) => execGitToplevel(cwd))`.
 */
export function processCache<K, V>(loader: (k: K) => Promise<V>): (k: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key: K): Promise<V> => {
    let promise = cache.get(key);
    if (promise === undefined) {
      promise = loader(key);
      cache.set(key, promise);
    }
    return promise;
  };
}
