/**
 * extends-chain.ts — `extends` chain resolver (T039).
 *
 * Resolves the (possibly multi-level) `extends` chain rooted at a config,
 * loading each parent (local file or `https://` URL), then deep-merging
 * parents-first / current-config-overlays-last per design-doc §3.4.2.
 *
 * Security boundaries (per IMP-SEC-04, IMP-SEC-05, IMP-SEC-08):
 *
 *   - Only `https://` URLs are permitted for remote extends. `http://`,
 *     `file://`, `git://`, etc. are rejected with
 *     `CONFIG_EXTENDS_PROTOCOL_REJECTED`.
 *   - Local relative paths are resolved against the parent config's
 *     directory and must land inside the workspace root OR inside a
 *     `node_modules` directory; anything else is rejected with
 *     `CONFIG_PATH_TRAVERSAL`.
 *   - Remote fetches use `AbortSignal.timeout(10_000)` (10-second cap),
 *     enforce a 1 MB body size cap (counted byte-by-byte from the streamed
 *     response), and require a 200 response status.
 *   - Remote bodies are parsed with `JSON.parse(text)` — no reviver — to
 *     avoid reviver-eval surface (defense-in-depth per IMP-SEC-08).
 *   - Deep-merge refuses any object key named `__proto__`, `constructor`,
 *     or `prototype`, throwing `CONFIG_PROTOTYPE_POLLUTION`. The resolved
 *     output is built on a null-prototype base so accidental pollution at
 *     the top level cannot reach `Object.prototype`.
 *   - Cycle detection: a per-resolution `Set<string>` of canonical paths /
 *     normalised URLs. A cycle reuses the depth-cap error code/message
 *     because behaviourally both terminate an unbounded extends graph.
 *   - Depth cap: `MAX_EXTENDS_DEPTH = 10`.
 *
 * The resolver is fetch-injected so unit tests can supply a stub `fetch`
 * (no real HTTPS server required).
 */
import { dirname, extname, isAbsolute, resolve as resolvePath, sep } from 'node:path';
import { FugaziConfigError } from '@fugazi/types';
import { loadJsonConfig } from './loaders/json.js';
import { loadTomlConfig } from './loaders/toml.js';
import { loadTsConfig } from './loaders/ts.js';

/** Maximum depth of an `extends` chain (per E6). */
export const MAX_EXTENDS_DEPTH = 10;

/** Default HTTPS timeout for remote `extends` (10 seconds, per IMP-SEC-05). */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/** Maximum response body size for a remote `extends` (1 MB, per IMP-SEC-05). */
export const MAX_REMOTE_BODY_BYTES = 1_000_000;

/** Object keys we refuse to merge to avoid prototype pollution. */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Per-call options. `fetchImpl` lets tests inject a stub fetch.
 * `workspaceRoot` defaults to the directory of the root config; resolved
 * extends paths must lie inside it (or inside any `node_modules` dir).
 * `fetchTimeoutMs` defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}; tests
 * lower it to keep timeout assertions snappy.
 */
export interface ResolveExtendsOptions {
  readonly fetchImpl?: typeof fetch;
  readonly workspaceRoot?: string;
  readonly fetchTimeoutMs?: number;
}

/**
 * Resolve `config.extends` (recursively) and return the deep-merged result.
 *
 * The returned object never carries the `extends` field — it is stripped
 * after merging.
 */
export async function resolveExtendsChain(
  rootConfigPath: string,
  rootConfig: unknown,
  options: ResolveExtendsOptions = {},
): Promise<unknown> {
  const workspaceRoot = options.workspaceRoot ?? dirname(rootConfigPath);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  const ctx: ResolveContext = {
    workspaceRoot,
    fetchImpl,
    fetchTimeoutMs,
    visited: new Set<string>(),
    remoteCache: new Map<string, unknown>(),
  };

  return resolveOne(rootConfigPath, rootConfig, 0, ctx);
}

interface ResolveContext {
  readonly workspaceRoot: string;
  readonly fetchImpl: typeof fetch;
  readonly fetchTimeoutMs: number;
  readonly visited: Set<string>;
  readonly remoteCache: Map<string, unknown>;
}

/**
 * Recursive worker. Tracks depth and visited keys; loads each parent and
 * deep-merges in spec order (parents left-to-right, then current overlays).
 */
async function resolveOne(
  configKey: string,
  config: unknown,
  depth: number,
  ctx: ResolveContext,
): Promise<unknown> {
  if (depth > MAX_EXTENDS_DEPTH) {
    throw new FugaziConfigError({
      code: 'CONFIG_EXTENDS_DEPTH_EXCEEDED',
      message: `extends: chain depth ≥ 10 at '${configKey}'`,
    });
  }
  if (ctx.visited.has(configKey)) {
    throw new FugaziConfigError({
      code: 'CONFIG_EXTENDS_DEPTH_EXCEEDED',
      message: `extends: chain depth ≥ 10 at '${configKey}'`,
    });
  }
  ctx.visited.add(configKey);

  if (!isPlainObject(config)) {
    // Even non-plain objects could be a polluted parse result; scan and
    // either throw or return unchanged.
    return assertSafe(config, configKey);
  }

  // Scan the loaded config for dangerous own keys (e.g. an inline
  // `constructor` overlay) before any merge work happens.
  assertSafe(config, configKey);

  // Pull and strip the extends field; keep a typed reference for iteration.
  const extendsField = config.extends;
  if (extendsField === undefined || extendsField === null) {
    return stripExtends(config);
  }

  const extendsRefs: readonly string[] = Array.isArray(extendsField)
    ? extendsField.filter((s): s is string => typeof s === 'string')
    : typeof extendsField === 'string'
      ? [extendsField]
      : [];

  // Load each parent fully resolved. Parents are merged left-to-right so
  // later parents override earlier (per design-doc §3.4.2).
  const resolvedParents: unknown[] = [];
  for (const ref of extendsRefs) {
    const parentKey = await resolveRef(configKey, ref, ctx);
    const parentRaw = await loadByKey(parentKey, ctx);
    // Branch the visited set so siblings don't see each other's keys.
    const branched: ResolveContext = { ...ctx, visited: new Set(ctx.visited) };
    const parentResolved = await resolveOne(parentKey, parentRaw, depth + 1, branched);
    resolvedParents.push(parentResolved);
  }

  // Deep-merge parents in array order, then overlay current config last.
  // Source-path tracking is used by the prototype-pollution guard.
  let merged: unknown = nullProtoObject();
  for (const parent of resolvedParents) {
    merged = deepMerge(merged, parent, configKey);
  }
  merged = deepMerge(merged, stripExtends(config), configKey);
  return merged;
}

/**
 * Strip the `extends` field from a config object so it doesn't bleed into
 * the merged output.
 */
function stripExtends(config: Record<string, unknown>): Record<string, unknown> {
  if (!('extends' in config)) return config;
  const out: Record<string, unknown> = nullProtoObject();
  for (const key of Object.keys(config)) {
    if (key === 'extends') continue;
    out[key] = config[key];
  }
  return out;
}

/**
 * Build a fresh object with `Object.create(null)` so accidental pollution
 * at the merge root cannot escape onto Object.prototype.
 */
function nullProtoObject(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

/**
 * Resolve an `extends` reference into either an absolute file path or a
 * normalised `https://` URL. Enforces:
 *   - https-only protocol gate for any URL-shaped ref.
 *   - path-traversal guard for filesystem refs.
 */
async function resolveRef(parentKey: string, ref: string, ctx: ResolveContext): Promise<string> {
  // URL-shaped? Only `https://` is allowed; everything else is rejected
  // with a verbatim protocol message.
  const schemeMatch = ref.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? '').toLowerCase();
    if (scheme !== 'https') {
      throw new FugaziConfigError({
        code: 'CONFIG_EXTENDS_PROTOCOL_REJECTED',
        message: `extends: only https:// is allowed for remote configs, got '${scheme}'`,
      });
    }
    return ref;
  }

  // Filesystem ref. If the parent was a remote URL, relative paths cannot
  // be resolved (no enclosing directory). For now, treat that as a parse
  // failure.
  if (isRemoteKey(parentKey)) {
    throw new FugaziConfigError({
      code: 'CONFIG_PARSE_FAILED',
      message: `extends: relative paths are not supported when the parent config is remote: '${ref}'`,
    });
  }

  const parentDir = dirname(parentKey);
  const resolved = isAbsolute(ref) ? ref : resolvePath(parentDir, ref);

  // Guard: must live inside workspace root OR a node_modules directory.
  if (!isInsideWorkspace(resolved, ctx.workspaceRoot) && !isInsideNodeModules(resolved)) {
    throw new FugaziConfigError({
      code: 'CONFIG_PATH_TRAVERSAL',
      message: `extends: path traversal blocked: '${resolved}' is outside workspace and node_modules`,
    });
  }

  return resolved;
}

/** A "key" is remote if it starts with `https://`. */
function isRemoteKey(key: string): boolean {
  return key.startsWith('https://');
}

/**
 * Returns true when `target` lies under `root` (case-insensitive on Windows
 * because volumes / paths are case-insensitive there).
 */
function isInsideWorkspace(target: string, root: string): boolean {
  const a = process.platform === 'win32' ? target.toLowerCase() : target;
  const b = process.platform === 'win32' ? root.toLowerCase() : root;
  if (a === b) return true;
  return a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/**
 * Returns true when any segment of `target` is `node_modules`. We check for
 * the segment surrounded by separators or appearing at start/end.
 */
function isInsideNodeModules(target: string): boolean {
  const segments = target.split(/[\\/]/);
  return segments.includes('node_modules');
}

/**
 * Load the raw config object identified by `key` — either an absolute file
 * path or a normalised `https://` URL.
 */
async function loadByKey(key: string, ctx: ResolveContext): Promise<unknown> {
  if (isRemoteKey(key)) {
    return loadRemoteJson(key, ctx);
  }
  const ext = extname(key).toLowerCase();
  switch (ext) {
    case '.json':
    case '.jsonc':
      return loadJsonConfig(key);
    case '.ts':
      return loadTsConfig(key);
    case '.toml':
      return loadTomlConfig(key);
    default:
      throw new FugaziConfigError({
        code: 'CONFIG_PARSE_FAILED',
        message: `extends: unsupported config extension: '${ext}'`,
      });
  }
}

/**
 * Fetch and parse a remote `https://` config. Enforces a 10-second timeout,
 * 1 MB body cap, status==200, and JSON-only wire format. Caches the parsed
 * result inside `ctx.remoteCache` so repeated references in one resolution
 * fetch only once.
 */
async function loadRemoteJson(url: string, ctx: ResolveContext): Promise<unknown> {
  const cached = ctx.remoteCache.get(url);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.fetchTimeoutMs);
  let response: Response;
  try {
    response = await ctx.fetchImpl(url, { signal: controller.signal });
  } catch (cause) {
    clearTimeout(timer);
    if (isAbortError(cause)) {
      throw new FugaziConfigError({
        code: 'CONFIG_PARSE_FAILED',
        message: `extends: timed out fetching '${url}' after 10 seconds`,
      });
    }
    throw new FugaziConfigError({
      code: 'CONFIG_PARSE_FAILED',
      message: `extends: failed to fetch '${url}'`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }
  clearTimeout(timer);

  if (response.status !== 200) {
    throw new FugaziConfigError({
      code: 'CONFIG_PARSE_FAILED',
      message: `extends: remote config returned HTTP ${response.status} for '${url}'`,
    });
  }

  // Read the body with manual byte counting so we abort on oversize before
  // buffering the entire payload.
  const text = await readBodyWithSizeCap(response, url, MAX_REMOTE_BODY_BYTES);

  let parsed: unknown;
  try {
    // No reviver — defense-in-depth per IMP-SEC-08.
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new FugaziConfigError({
      code: 'CONFIG_PARSE_FAILED',
      message: `extends: failed to parse remote JSON config at '${url}'`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  ctx.remoteCache.set(url, parsed);
  return parsed;
}

/**
 * Read a Response body chunk-by-chunk into a UTF-8 string, throwing if the
 * cumulative byte count exceeds `cap`. Falls back to `response.text()` when
 * the response has no readable stream (some test mocks).
 */
async function readBodyWithSizeCap(response: Response, url: string, cap: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = await response.text();
    if (new TextEncoder().encode(fallback).byteLength > cap) {
      throw new FugaziConfigError({
        code: 'CONFIG_PARSE_FAILED',
        message: `extends: remote config exceeds 1MB size cap: '${url}'`,
      });
    }
    return fallback;
  }
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          // best-effort
        }
        throw new FugaziConfigError({
          code: 'CONFIG_PARSE_FAILED',
          message: `extends: remote config exceeds 1MB size cap: '${url}'`,
        });
      }
      out += decoder.decode(value, { stream: true });
    }
  }
  out += decoder.decode();
  return out;
}

/**
 * Detect AbortError across runtimes. Some fetch impls throw a
 * `DOMException`, others throw a regular Error with `name === 'AbortError'`.
 */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Deep-merge two values per design-doc §3.4.2:
 *   - Both plain objects → recurse field-by-field with overlay precedence.
 *   - Otherwise (arrays, scalars, undefined) → overlay wins, falling back
 *     to base when overlay is undefined.
 *
 * `sourcePath` is the path/URL the overlay came from; it is named in the
 * prototype-pollution error so the offending parent is identifiable.
 */
function deepMerge(base: unknown, overlay: unknown, sourcePath: string): unknown {
  if (overlay === undefined) return base;
  if (base === undefined) {
    // overlay alone: still need to scan it for dangerous keys recursively.
    return assertSafe(overlay, sourcePath);
  }
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return assertSafe(overlay, sourcePath);
  }

  const out: Record<string, unknown> = nullProtoObject();
  // Combine keys preserving overlay-last semantics for stable iteration.
  const keys = uniqueOrderedKeys(base, overlay);
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new FugaziConfigError({
        code: 'CONFIG_PROTOTYPE_POLLUTION',
        message: `extends: refusing to merge dangerous key '${key}' from '${sourcePath}'`,
      });
    }
    const b = base[key];
    const o = overlay[key];
    out[key] = deepMerge(b, o, sourcePath);
  }
  return out;
}

/**
 * Recursively scan a value for dangerous keys before returning it. This
 * catches pollution payloads inside arrays-of-objects or nested overlays
 * where the top-level merge wouldn't have triggered.
 *
 * Note: when JSON is parsed by `jsonc-parser`, an input key of
 * `"__proto__"` mutates the resulting object's `[[Prototype]]` instead of
 * creating an own data property — so a tampered object surfaces as
 * "non-Object.prototype proto" rather than as an own key. We detect both
 * forms.
 */
function assertSafe(value: unknown, sourcePath: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) assertSafe(item, sourcePath);
    return value;
  }
  if (value === null || typeof value !== 'object') return value;

  // Guard against jsonc-parser's `__proto__`-via-setter pollution: a real
  // user object should have `Object.prototype` (or `null`) as its prototype.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new FugaziConfigError({
      code: 'CONFIG_PROTOTYPE_POLLUTION',
      message: `extends: refusing to merge dangerous key '__proto__' from '${sourcePath}'`,
    });
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new FugaziConfigError({
        code: 'CONFIG_PROTOTYPE_POLLUTION',
        message: `extends: refusing to merge dangerous key '${key}' from '${sourcePath}'`,
      });
    }
    assertSafe((value as Record<string, unknown>)[key], sourcePath);
  }
  return value;
}

/**
 * Return a stable list of keys from `base` then any new keys from
 * `overlay`. Insertion order is preserved across runs because both inputs
 * are read in declaration order.
 */
function uniqueOrderedKeys(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of Object.keys(base)) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  for (const key of Object.keys(overlay)) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Tight "plain object" check — true only for objects whose prototype is
 * `Object.prototype` or null. Array, Date, Map, Set, class instances are
 * all rejected so they take the overlay-wins path.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
