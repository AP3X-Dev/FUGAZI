/**
 * tsconfig-paths.ts — T083 / T084 — tsconfig.json `compilerOptions.paths` resolver.
 *
 * Implements TypeScript's path-mapping resolution as specified in the
 * compiler handbook:
 *
 *   1. Walk up from the importing file's directory until a `tsconfig.json`
 *      is found. The first hit wins; we do NOT follow `extends` chains in
 *      this submodule (that complexity is deferred to a future pass).
 *   2. Read `compilerOptions.baseUrl` (default: the tsconfig's directory)
 *      and `compilerOptions.paths`.
 *   3. Match the specifier against each `paths` key. Patterns may contain a
 *      single `*` wildcard. The longest-pattern match wins; among equal-
 *      length matches, declaration order is the tiebreaker.
 *   4. For the winning pattern, iterate the `paths[<key>]` array in
 *      declaration order. Each entry is substituted (the captured tail
 *      replaces `*`), joined to baseUrl, and probed exactly like a relative
 *      import. The first probe that hits wins.
 *
 * Caching:
 *   - Parsed tsconfig.json contents are cached process-wide, keyed by
 *     absolute path. The cache is module-local and only ever grows; tests
 *     that need a fresh state should construct fresh paths.
 *   - The "nearest tsconfig" lookup is cached per-directory inside a single
 *     resolution session. This module exposes the cache via
 *     `__clearTsconfigCacheForTest`.
 *
 * Robustness:
 *   - JSON parse errors are swallowed (treated as absent tsconfig). Real
 *     tsconfig files routinely contain `//` line comments — we strip them
 *     before parsing.
 *   - Missing files / IO errors silently return null.
 */

import type { FsAdapter } from './fs-adapter.js';
import { dirnamePosix, isAbsolutePosix, joinPosix, rootOfPosix } from './path-utils.js';
import { RELATIVE_EXTENSIONS } from './relative.js';

interface ParsedTsconfig {
  readonly baseUrl: string;
  readonly paths: ReadonlyMap<string, readonly string[]>;
}

const tsconfigParseCache = new Map<string, ParsedTsconfig | null>();
const nearestTsconfigCache = new Map<string, string | null>();

/**
 * Strip JSON-with-comments artefacts (single-line `//` comments and block
 * `/* *\/` comments) before passing to `JSON.parse`. Trailing commas are
 * tolerated — TypeScript's tsconfig dialect allows them.
 */
function stripJsonComments(src: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  let stringQuote = '';
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      // Line comment — skip to newline.
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  // Strip trailing commas before `}` or `]`.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function parseTsconfigAt(absPath: string, fs: FsAdapter): ParsedTsconfig | null {
  const cached = tsconfigParseCache.get(absPath);
  if (cached !== undefined) return cached;

  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch {
    tsconfigParseCache.set(absPath, null);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch {
    tsconfigParseCache.set(absPath, null);
    return null;
  }

  if (parsed === null || typeof parsed !== 'object') {
    tsconfigParseCache.set(absPath, null);
    return null;
  }
  const root = parsed as Record<string, unknown>;
  const compilerOptions =
    typeof root.compilerOptions === 'object' && root.compilerOptions !== null
      ? (root.compilerOptions as Record<string, unknown>)
      : {};

  const tsconfigDir = dirnamePosix(absPath);
  const rawBaseUrl = compilerOptions.baseUrl;
  const baseUrl =
    typeof rawBaseUrl === 'string' && rawBaseUrl !== ''
      ? isAbsolutePosix(rawBaseUrl)
        ? rawBaseUrl
        : joinPosix(tsconfigDir, rawBaseUrl)
      : tsconfigDir;

  const pathsValue = compilerOptions.paths;
  const paths = new Map<string, readonly string[]>();
  if (pathsValue !== undefined && pathsValue !== null && typeof pathsValue === 'object') {
    for (const [key, value] of Object.entries(pathsValue as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const cleaned: string[] = [];
      for (const entry of value) {
        if (typeof entry === 'string') cleaned.push(entry);
      }
      paths.set(key, Object.freeze(cleaned));
    }
  }

  const result: ParsedTsconfig = { baseUrl, paths };
  tsconfigParseCache.set(absPath, result);
  return result;
}

/**
 * Walk up from `fromFile`'s directory until a `tsconfig.json` is found.
 * Returns the absolute POSIX path, or `null` if none exists between
 * `fromFile` and the filesystem root.
 */
export function findNearestTsconfig(fromFile: string, fs: FsAdapter): string | null {
  const startDir = dirnamePosix(fromFile);
  const cached = nearestTsconfigCache.get(startDir);
  if (cached !== undefined) return cached;

  const root = rootOfPosix(startDir) || '/';
  let current = startDir;
  // Cap the walk at a generous depth to prevent any pathological loop on
  // unexpected inputs (e.g. a `dirnamePosix` that doesn't shorten).
  for (let i = 0; i < 64; i += 1) {
    const candidate = joinPosix(current, 'tsconfig.json');
    if (fs.existsSync(candidate) && !fs.isDirectorySync(candidate)) {
      nearestTsconfigCache.set(startDir, candidate);
      return candidate;
    }
    if (current === root || current === '') break;
    const parent = dirnamePosix(current);
    if (parent === current) break;
    current = parent;
  }
  nearestTsconfigCache.set(startDir, null);
  return null;
}

interface PatternMatch {
  readonly pattern: string;
  readonly tail: string;
  readonly score: number;
}

function matchPattern(pattern: string, specifier: string): PatternMatch | null {
  const star = pattern.indexOf('*');
  if (star === -1) {
    if (specifier === pattern) {
      return { pattern, tail: '', score: pattern.length };
    }
    return null;
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  if (specifier.length < prefix.length + suffix.length) return null;
  const tail = specifier.slice(prefix.length, specifier.length - suffix.length);
  // Score = total non-wildcard characters matched. Longer fixed parts win.
  return { pattern, tail, score: prefix.length + suffix.length };
}

function probeMappedTarget(target: string, fs: FsAdapter): string | null {
  // Already-extensioned target.
  for (const ext of RELATIVE_EXTENSIONS) {
    if (target.endsWith(ext)) {
      return fs.existsSync(target) && !fs.isDirectorySync(target) ? target : null;
    }
  }
  if (target.endsWith('.json')) {
    return fs.existsSync(target) && !fs.isDirectorySync(target) ? target : null;
  }
  // Extension probe.
  for (const ext of RELATIVE_EXTENSIONS) {
    const probe = `${target}${ext}`;
    if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
  }
  // Directory index.
  if (fs.isDirectorySync(target)) {
    for (const ext of RELATIVE_EXTENSIONS) {
      const probe = joinPosix(target, `index${ext}`);
      if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
    }
  }
  return null;
}

/**
 * Resolve `specifier` via tsconfig.json `paths` mappings. Returns the matched
 * POSIX path or `null` if no pattern matches or no candidate exists on disk.
 *
 * The caller may pre-supply a parsed `paths` table via the
 * `ResolverContext.tsconfigPaths` option to skip filesystem discovery — this
 * is what tests use to drive the resolver hermetically.
 */
export function resolveTsconfigPaths(
  specifier: string,
  fromFile: string,
  fs: FsAdapter,
  preParsed?: { readonly baseUrl: string; readonly paths: ReadonlyMap<string, readonly string[]> },
): string | null {
  let parsed: ParsedTsconfig | null;
  if (preParsed !== undefined) {
    parsed = preParsed;
  } else {
    const tsconfigPath = findNearestTsconfig(fromFile, fs);
    if (tsconfigPath === null) return null;
    parsed = parseTsconfigAt(tsconfigPath, fs);
  }
  if (parsed === null) return null;
  if (parsed.paths.size === 0) return null;

  let best: PatternMatch | null = null;
  for (const pattern of parsed.paths.keys()) {
    const m = matchPattern(pattern, specifier);
    if (m === null) continue;
    if (best === null || m.score > best.score) {
      best = m;
    }
  }
  if (best === null) return null;

  const replacements = parsed.paths.get(best.pattern) ?? [];
  for (const replacement of replacements) {
    const substituted = replacement.includes('*')
      ? replacement.replace('*', best.tail)
      : replacement;
    const target = isAbsolutePosix(substituted)
      ? substituted
      : joinPosix(parsed.baseUrl, substituted);
    const hit = probeMappedTarget(target, fs);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Test-only: clear all caches. Production code never calls this.
 */
export function __clearTsconfigCacheForTest(): void {
  tsconfigParseCache.clear();
  nearestTsconfigCache.clear();
}
