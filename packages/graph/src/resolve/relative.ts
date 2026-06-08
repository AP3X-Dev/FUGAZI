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
 * Extensions probed when a relative specifier has no extension. TS / TSX
 * come before JS variants; declaration files come last so a runtime sibling
 * wins when both exist.
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
 * TypeScript-ESM extension fallbacks. With `"moduleResolution": "NodeNext"`
 * (and friends) the convention is for source files to write
 * `import './foo.js'` even though the file on disk is `./foo.ts`. The TS
 * compiler rewrites the extension at emit time.
 *
 * Mirror that behaviour: when a relative specifier ends in a JS-family
 * extension and the literal file is absent, probe the corresponding TS-family
 * extension(s) before declaring a miss.
 *
 * Order matters — the first hit wins. `.js` falls back to `.ts` first then
 * `.tsx` so a project that has both flavours of a module still picks the
 * primary `.ts` over the `.tsx`.
 */
const JS_TO_TS_FALLBACKS: ReadonlyMap<string, readonly string[]> = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

function tryJsToTsFallback(candidate: string, fs: FsAdapter): string | null {
  for (const [jsExt, tsExts] of JS_TO_TS_FALLBACKS) {
    if (!candidate.endsWith(jsExt)) continue;
    const stem = candidate.slice(0, candidate.length - jsExt.length);
    for (const tsExt of tsExts) {
      const probe = `${stem}${tsExt}`;
      if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
    }
    // Only one prefix matches per candidate (extensions are mutually
    // exclusive); break after the first match.
    return null;
  }
  return null;
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
    if (fs.existsSync(candidate) && !fs.isDirectorySync(candidate)) return candidate;
    // 1a. TS-ESM convention: `./foo.js` written in source maps to `./foo.ts`
    //     on disk after the TS compiler rewrites extensions. Try the TS-family
    //     fallback before giving up.
    const tsFallback = tryJsToTsFallback(candidate, fs);
    if (tsFallback !== null) return tsFallback;
    return null;
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
