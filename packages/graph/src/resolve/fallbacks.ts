/**
 * fallbacks.ts — T087 / T088 — last-resort resolver fallbacks.
 *
 * When the primary resolvers fail, these helpers attempt:
 *
 *   1. Build-output mapping: `<pkg>/dist/foo.js` -> `<pkg>/src/foo.ts`.
 *      Triggered when a node_modules path resolves to a built artefact but
 *      the workspace publishes the source under `src/`.
 *   2. Sibling index probing: when the specifier looks like a directory but
 *      the standard probes missed an `index.<ext>`, try a wider sweep
 *      including `.json` and `.cjs`.
 *
 * Pure functions — no IO except through the supplied adapter; no caching.
 */

import type { FsAdapter } from './fs-adapter.js';
import { joinPosix } from './path-utils.js';

const OUTPUT_DIRS: ReadonlySet<string> = new Set([
  'dist',
  'build',
  'out',
  'lib',
  'esm',
  'cjs',
  'umd',
]);

const SOURCE_EXTS: readonly string[] = Object.freeze([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/**
 * Try to map a resolved output path back to its source file.
 *
 * Mirrors the original Fallow Rust algorithm:
 *   - Find the LAST output directory segment in the path (closest to file).
 *   - Walk backwards collecting consecutive output-dir segments.
 *   - Replace those segments with `src` and probe each source extension.
 *
 * Returns the resolved source path or `null`.
 */
export function tryOutputToSourceFallback(resolvedPath: string, fs: FsAdapter): string | null {
  const segments = resolvedPath.split('/');
  // Find last output-dir index.
  let lastOutput = -1;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (OUTPUT_DIRS.has(segments[i] ?? '')) {
      lastOutput = i;
      break;
    }
  }
  if (lastOutput === -1) return null;

  let firstOutput = lastOutput;
  while (firstOutput > 0 && OUTPUT_DIRS.has(segments[firstOutput - 1] ?? '')) {
    firstOutput -= 1;
  }

  const prefixSegments = segments.slice(0, firstOutput);
  const suffixSegments = segments.slice(lastOutput + 1);
  if (suffixSegments.length === 0) return null;

  const prefixPath = prefixSegments.join('/') || '/';
  const suffixPath = suffixSegments.join('/');
  const dotIdx = suffixPath.lastIndexOf('.');
  const stem = dotIdx === -1 ? suffixPath : suffixPath.slice(0, dotIdx);
  if (stem === '') return null;

  for (const ext of SOURCE_EXTS) {
    const candidate = joinPosix(joinPosix(prefixPath, 'src'), `${stem}${ext}`);
    if (fs.existsSync(candidate) && !fs.isDirectorySync(candidate)) return candidate;
  }
  return null;
}

/**
 * Try a wider directory-index sweep, including `.json` and `.cjs` which the
 * standard relative resolver does not probe by default.
 */
export function tryWideIndexProbe(target: string, fs: FsAdapter): string | null {
  if (!fs.isDirectorySync(target)) return null;
  const exts: readonly string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
  for (const ext of exts) {
    const probe = joinPosix(target, `index${ext}`);
    if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
  }
  return null;
}
