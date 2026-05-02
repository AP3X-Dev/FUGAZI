/**
 * relative.ts — T081 / T082 — relative-specifier resolver.
 *
 * Handles import specifiers that begin with `.` or `..`. The result is
 * relative to the importing file's parent directory, normalized to POSIX
 * form, and probed against the filesystem in this exact order:
 *
 *   1. If the specifier already carries a known extension, stat it directly.
 *   2. Otherwise, append each candidate extension in
 *      `RELATIVE_EXTENSIONS` order and stat each.
 *   3. If none match, treat the result as a directory and probe
 *      `<resolved>/index<ext>` for each extension.
 *
 * Returns the resolved POSIX path on success, `null` on miss. Never throws.
 *
 * Determinism: extensions are probed in a fixed, frozen order. No
 * directory enumeration is performed — every candidate path is materialized
 * deterministically from the specifier alone.
 *
 * Path-traversal note: `joinPosix` + `normalizePosix` already collapse `..`
 * segments, so `../../etc/passwd` from a deep file resolves to whatever
 * lexical path that produces without escaping the FS root. The resolver
 * does NOT prevent traversal — it just reports what the path would resolve
 * to. Sandboxing is the consumer's job.
 */
import type { FsAdapter } from './fs-adapter.js';
import { dirnamePosix, joinPosix } from './path-utils.js';

/**
 * Extensions probed when a relative specifier has no extension. The order
 * matches the original Fallow Rust resolver (TS / TSX before JS variants;
 * declaration files come last so a runtime sibling wins when both exist).
 *
 * Frozen for determinism — a downstream caller cannot mutate the order
 * mid-run and produce drift across files.
 */
export const RELATIVE_EXTENSIONS: readonly string[] = Object.freeze([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.d.ts',
]);

/**
 * Set of extensions recognized as "already resolved" — when the specifier
 * ends with one of these, we skip extension probing and stat the path
 * directly.
 */
const KNOWN_EXT_SET: ReadonlySet<string> = new Set([
  ...RELATIVE_EXTENSIONS,
  '.json',
  '.css',
  '.scss',
  '.sass',
  '.vue',
  '.svelte',
  '.astro',
  '.mdx',
]);

function endsWithKnownExtension(p: string): boolean {
  // `.d.ts` must be checked before `.ts` so a file like `index.d.ts` is not
  // misclassified.
  for (const ext of KNOWN_EXT_SET) {
    if (p.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Resolve a relative specifier (`./foo`, `../bar`, `./mod.ts`) against the
 * importing file's directory.
 *
 * @param specifier  The raw import specifier (must start with `.`).
 * @param fromFile   The importing file's POSIX path.
 * @param fs         Filesystem adapter (production: nodeFsAdapter).
 * @returns          The resolved POSIX path, or `null` if no candidate exists.
 */
export function resolveRelative(specifier: string, fromFile: string, fs: FsAdapter): string | null {
  if (
    !(
      specifier.startsWith('./') ||
      specifier.startsWith('../') ||
      specifier === '.' ||
      specifier === '..'
    )
  ) {
    return null;
  }
  const fromDir = dirnamePosix(fromFile);
  const candidate = joinPosix(fromDir, specifier);

  // 1. Specifier already carries a known extension — stat directly.
  if (endsWithKnownExtension(candidate)) {
    return fs.existsSync(candidate) && !fs.isDirectorySync(candidate) ? candidate : null;
  }

  // 2. Probe extensions in the fixed order.
  for (const ext of RELATIVE_EXTENSIONS) {
    const probe = `${candidate}${ext}`;
    if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
  }

  // 3. Treat as a directory: probe `<candidate>/index<ext>`.
  if (fs.isDirectorySync(candidate)) {
    for (const ext of RELATIVE_EXTENSIONS) {
      const probe = joinPosix(candidate, `index${ext}`);
      if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
    }
  }

  return null;
}
