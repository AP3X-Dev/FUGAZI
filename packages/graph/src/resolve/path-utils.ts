/**
 * path-utils.ts — POSIX path helpers shared by every resolver submodule.
 *
 * The resolver works exclusively in POSIX-normalized paths (forward slashes).
 * Callers that pass Windows-style paths must convert via
 * `@fugazi/types` `canonicalize()` first; this module does NOT round-trip
 * through `node:path` because the platform-specific separator would defeat
 * determinism (the same fixture must produce the same string on every OS).
 *
 * Functions here are pure — no IO, no `Date.now`, no `Math.random` — and
 * accept readonly inputs.
 */

/**
 * Normalize a POSIX path: collapse `.` and `..` segments, strip duplicate
 * slashes, and preserve a leading `/` (or drive letter on Windows-canonical
 * inputs like `C:/foo`).
 *
 * Returns `''` only if the input is empty; never throws.
 */
export function normalizePosix(p: string): string {
  if (p === '') return '';
  // Detect drive prefix (e.g. `C:/`) and preserve it through normalization.
  let prefix = '';
  let body = p;
  if (body.length >= 2 && body[1] === ':') {
    prefix = body.slice(0, 2);
    body = body.slice(2);
  }
  const isAbsolute = body.startsWith('/');
  const segments = body.split('/');
  const result: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // Pop unless it would escape an absolute root.
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else if (!isAbsolute) {
        result.push('..');
      }
      continue;
    }
    result.push(segment);
  }
  const joined = result.join('/');
  if (prefix !== '') {
    return `${prefix}${isAbsolute ? '/' : ''}${joined}`;
  }
  return isAbsolute ? `/${joined}` : joined;
}

/**
 * Return the parent directory of `p` in POSIX form. The root (`/`, `C:/`)
 * has no parent and is returned as-is.
 */
export function dirnamePosix(p: string): string {
  if (p === '') return '';
  // Drive root: `C:/foo` -> `C:/`; `C:/` -> `C:/`.
  if (p.length >= 3 && p[1] === ':' && p[2] === '/') {
    if (p.length === 3) return p;
    const slash = p.lastIndexOf('/');
    if (slash <= 2) return p.slice(0, 3);
    return p.slice(0, slash);
  }
  if (p === '/') return '/';
  const slash = p.lastIndexOf('/');
  if (slash === -1) return '';
  if (slash === 0) return '/';
  return p.slice(0, slash);
}

/**
 * Join two POSIX path fragments and normalize the result.
 */
export function joinPosix(base: string, child: string): string {
  if (base === '') return normalizePosix(child);
  if (child === '') return normalizePosix(base);
  if (child.startsWith('/') || (child.length >= 2 && child[1] === ':')) {
    return normalizePosix(child);
  }
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return normalizePosix(`${trimmed}/${child}`);
}

/**
 * Return `true` if `p` is an absolute POSIX-style path (`/foo`, `C:/foo`).
 */
export function isAbsolutePosix(p: string): boolean {
  if (p.startsWith('/')) return true;
  if (p.length >= 3 && p[1] === ':' && p[2] === '/') return true;
  return false;
}

/**
 * Return the filesystem root for `p`. `/foo/bar` -> `/`; `C:/foo` -> `C:/`.
 * Returns `''` for relative paths.
 */
export function rootOfPosix(p: string): string {
  if (p.startsWith('/')) return '/';
  if (p.length >= 3 && p[1] === ':' && p[2] === '/') return p.slice(0, 3);
  return '';
}
