/**
 * package-json.ts — load + cache `package.json` parsed payloads.
 *
 * Process-singleton cache keyed by absolute POSIX path. Parse errors and
 * IO errors are cached as `null` so repeated probes do not retry the
 * filesystem.
 *
 * The shape returned here is intentionally narrow — only the fields the
 * resolver consumes (`main`, `module`, `exports`). Other fields are passed
 * through opaquely as `unknown` so callers needing the raw object can fall
 * back to it without a re-parse.
 */
import type { FsAdapter } from './fs-adapter.js';

export interface PackageJsonContents {
  readonly main?: string;
  readonly module?: string;
  readonly exports?: unknown;
  readonly raw: Readonly<Record<string, unknown>>;
}

const cache = new Map<string, PackageJsonContents | null>();

export function readPackageJson(absPath: string, fs: FsAdapter): PackageJsonContents | null {
  const cached = cache.get(absPath);
  if (cached !== undefined) return cached;

  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch {
    cache.set(absPath, null);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cache.set(absPath, null);
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    cache.set(absPath, null);
    return null;
  }
  const root = parsed as Record<string, unknown>;
  const result: PackageJsonContents = {
    ...(typeof root.main === 'string' ? { main: root.main } : {}),
    ...(typeof root.module === 'string' ? { module: root.module } : {}),
    ...(root.exports !== undefined ? { exports: root.exports } : {}),
    raw: root,
  };
  cache.set(absPath, result);
  return result;
}

/**
 * Test-only: clear the cache between fixture runs.
 */
export function __clearPackageJsonCacheForTest(): void {
  cache.clear();
}
