/**
 * fs-adapter.ts — synchronous filesystem abstraction for the resolver.
 *
 * The import-specifier resolver is a hot path: a single project can have tens
 * of thousands of import specifiers, each potentially probing a handful of
 * candidate paths. Going through `node:fs/promises` (async) would force the
 * caller to await every probe and would defeat the determinism guarantees
 * (NFR-1 / SC-15) — we want a single-pass, synchronous walk.
 *
 * To keep the resolver testable without touching the real filesystem, all FS
 * access goes through this `FsAdapter` interface. Production builds use
 * `nodeFsAdapter` which wraps `node:fs` sync APIs. Tests build an in-memory
 * adapter from a `Record<string, string>` (path -> file content).
 *
 * Conventions:
 *   - Path separators inside the adapter are POSIX forward-slashes. Callers
 *     normalize Windows backslashes before calling `existsSync` /
 *     `readFileSync` (e.g. via `@fugazi/types` `canonicalize()`).
 *   - `existsSync` returns `true` for both regular files and directories.
 *   - `realpathSync` is optional — most resolution paths never need it.
 */
import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  realpathSync as nodeRealpathSync,
  statSync as nodeStatSync,
} from 'node:fs';

export interface FsAdapter {
  /**
   * Return `true` if `path` exists (file or directory). Never throws.
   */
  existsSync(path: string): boolean;
  /**
   * Read `path` as UTF-8 text. Throws if the path does not exist or cannot
   * be read. Callers should treat any throw as "not present".
   */
  readFileSync(path: string, encoding: 'utf8'): string;
  /**
   * Return `true` if `path` is a directory. Used by the node_modules walker
   * and tsconfig discovery to avoid statting non-directories.
   */
  isDirectorySync(path: string): boolean;
  /**
   * Optional: resolve symlinks. Production wrappers should implement this;
   * test in-memory adapters can omit it (the resolver tolerates absence).
   */
  realpathSync?(path: string): string;
}

/**
 * The default node-backed adapter, frozen so consumers cannot accidentally
 * mutate it. Sync `node:fs` calls are wrapped in try/catch so resolver probes
 * never throw on permission errors or transient IO faults — they just report
 * "missing".
 */
export const nodeFsAdapter: FsAdapter = Object.freeze({
  existsSync(path: string): boolean {
    try {
      return nodeExistsSync(path);
    } catch {
      return false;
    }
  },
  readFileSync(path: string, encoding: 'utf8'): string {
    return nodeReadFileSync(path, encoding);
  },
  isDirectorySync(path: string): boolean {
    try {
      return nodeStatSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  realpathSync(path: string): string {
    return nodeRealpathSync(path);
  },
});

/**
 * Build an in-memory FsAdapter from a path-to-content map. Useful for tests
 * and for consumers that want to short-circuit resolution against a synthetic
 * filesystem.
 *
 * Path semantics:
 *   - Keys are POSIX-style absolute paths (test fixtures use `/project/...`).
 *   - A directory is implied by any key whose path starts with that directory
 *     plus a trailing `/`. `existsSync` returns `true` for explicit directory
 *     keys (those ending in `/`) and for any prefix shared by a file key.
 *   - `isDirectorySync` returns `true` only when the path is a directory
 *     (either an explicit directory key or a prefix of some file key).
 *   - `readFileSync` throws if the path is not registered as a file.
 */
export function createMemoryFsAdapter(files: Readonly<Record<string, string>>): FsAdapter {
  // Normalize: strip trailing slash from directory keys for prefix tests.
  const fileSet = new Set<string>();
  const dirSet = new Set<string>();
  for (const key of Object.keys(files)) {
    if (key.endsWith('/')) {
      dirSet.add(key.slice(0, -1));
    } else {
      fileSet.add(key);
      // Implicit ancestor directories.
      let parent = key;
      while (true) {
        const slash = parent.lastIndexOf('/');
        if (slash <= 0) break;
        parent = parent.slice(0, slash);
        dirSet.add(parent);
      }
    }
  }

  return Object.freeze({
    existsSync(path: string): boolean {
      const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
      return fileSet.has(normalized) || dirSet.has(normalized);
    },
    readFileSync(path: string, _encoding: 'utf8'): string {
      const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
      const content = files[normalized];
      if (content === undefined) {
        throw new Error(`ENOENT: no such file in memory adapter: ${path}`);
      }
      return content;
    },
    isDirectorySync(path: string): boolean {
      const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
      return dirSet.has(normalized) && !fileSet.has(normalized);
    },
  });
}
