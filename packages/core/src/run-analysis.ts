/**
 * run-analysis.ts — Phase 3f.1 (T131-T132) — single shared analysis driver.
 *
 * `runAnalysis(options)` is the canonical entry point used by every consumer
 * (CLI, LSP, MCP, programmatic Node API). It orchestrates the per-phase
 * pipeline:
 *
 *   1. discover  — enumerate source files under `projectRoot`.
 *   2. extract   — parse + buildInventory per file.
 *   3. graph     — buildGraph against the inventory set.
 *   4. analyze   — dispatch enabled rules (no-op until 3f.2..3f.6 land).
 *   5. crossref  — cross-reference pass (no-op until 3f.6 lands).
 *
 * Every consumer receives byte-identical `RunAnalysisResult.issues` for the
 * same `RunAnalysisOptions` (NFR-1 / SC-7 / SC-15). The `_meta.determinismHash`
 * is a SHA-256 over the canonical-sorted `JSON.stringify({ issues, actions })`,
 * proving byte-equality across runs.
 *
 * Cancellation: the driver checks `options.abortSignal?.aborted` at every
 * phase boundary. A cancelled run throws `FugaziCoreError(CORE_ABORTED)` with
 * the verbatim message `runAnalysis aborted at phase: <phase>`.
 *
 * No `JSON.parse(JSON.stringify(...))` round-trips between phases — shared
 * references flow forward (per IMP-PERF-15).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  type FileComplexity,
  type Inventory,
  type ParseError,
  buildInventory,
  buildPyInventory,
  computeComplexity,
  computeComplexityPy,
  parse,
  parsePythonAst,
} from '@fugazi/extract';
import {
  type FileNode,
  type Graph,
  type PythonManifest,
  buildGraph,
  loadPythonManifest,
  nodeFsAdapter,
} from '@fugazi/graph';
import {
  type PluginDef,
  detectActivePlugins,
  getBuiltinPlugins,
  loadExternalPlugin,
  matchesGlob,
} from '@fugazi/plugins';
import {
  type DiscriminatedIssue,
  type FileId,
  FugaziCoreError,
  type Range,
  type RuleId,
  assignFileIds,
} from '@fugazi/types';
import { type PluginCrossRefFilters, applyCrossReferenceFilter } from './cross-ref.js';
import { inferEntryPoints } from './infer-entrypoints.js';
import { ProgressEmitter } from './progress.js';
import { listEnabledRules, runEnabledRules } from './rules/registry.js';
import type { RuleContext } from './rules/types.js';
import { type RuntimeReport, runRuntime } from './runtime/index.js';
import type {
  AnalysisAction,
  AnalysisMetrics,
  RunAnalysisOptions,
  RunAnalysisResult,
} from './types.js';

/** Package version emitted in `RunAnalysisResult._meta.version`. */
const CORE_VERSION = '0.0.0';

/** Canonical phase name set, used in abort messages. */
type PhaseName = 'discover' | 'extract' | 'graph' | 'analyze' | 'crossref' | 'runtime';

/**
 * Run the full analysis pipeline. Returns a frozen `RunAnalysisResult`.
 *
 * Synchronous behaviour wrapped in a `Promise` because parsing is async;
 * everything past the parse step is synchronous so the returned promise
 * resolves after a single microtask round per file.
 */
export async function runAnalysis(options: RunAnalysisOptions): Promise<RunAnalysisResult> {
  validateOptions(options);

  const startedAt = performance.now();
  const emitter = new ProgressEmitter(options.onProgress);
  const signal = options.abortSignal;
  // POSIX-normalize the project root so it compares correctly against the
  // forward-slash FileNode paths on Windows (zone matching, import resolution,
  // entry-point and plugin path matching, and message path rebasing).
  const projectRoot = toPosix(options.projectRoot);

  let graph: Graph;
  let filesScanned: number;
  let complexityMap: ReadonlyMap<FileId, FileComplexity> = new Map();
  let complexityByPath: ReadonlyMap<string, FileComplexity> = new Map();
  // Phase 4e T361: per-run language metrics. Initialised to zero so the
  // preBuiltGraph fast path (which skips extract) still surfaces a fully
  // populated `filesByLang` and `parseErrors` block in metrics.
  let filesByLang: { ts: number; py: number } = { ts: 0, py: 0 };
  let parseErrorTotal = 0;
  let parseErrorByLang: { ts: number; py: number } = { ts: 0, py: 0 };

  if (options.preBuiltGraph !== undefined) {
    // Skip discover + extract + graph-build. Still emit the full event
    // sequence with zero counts so consumers see a consistent life-cycle.
    // Complexity is unavailable on this fast-path; health rules degrade to
    // no-emit when the map is empty.
    emitter.emit({ kind: 'discover.start' });
    checkAborted(signal, 'discover');
    emitter.emit({ kind: 'discover.done', fileCount: 0 });
    emitter.emit({ kind: 'extract.start', total: 0 });
    checkAborted(signal, 'extract');
    emitter.emit({ kind: 'extract.done' });
    emitter.emit({ kind: 'graph.start' });
    checkAborted(signal, 'graph');
    emitter.emit({ kind: 'graph.done', edgeCount: options.preBuiltGraph.edges.length });
    graph = options.preBuiltGraph;
    filesScanned = 0;
  } else {
    // Phase 1: discover.
    emitter.emit({ kind: 'discover.start' });
    checkAborted(signal, 'discover');
    const discovered = await discoverFiles(projectRoot, options.config.exclude);
    emitter.emit({ kind: 'discover.done', fileCount: discovered.length });
    checkAborted(signal, 'discover');

    // Phase 2: extract. Throttle progress emission to ~20 ticks total so
    // very large file sets don't flood the listener.
    emitter.emit({ kind: 'extract.start', total: discovered.length });
    checkAborted(signal, 'extract');
    const aggregate = await extractInventories(discovered, emitter, signal);
    const inventories = aggregate.outputs;
    filesByLang = { ts: aggregate.filesByLang.ts, py: aggregate.filesByLang.py };
    parseErrorTotal = aggregate.parseErrors.total;
    parseErrorByLang = {
      ts: aggregate.parseErrors.byLang.ts,
      py: aggregate.parseErrors.byLang.py,
    };
    emitter.emit({ kind: 'extract.done' });
    checkAborted(signal, 'extract');

    // Phase 3: graph. Shared inventories flow forward (no JSON round-trip).
    emitter.emit({ kind: 'graph.start' });
    checkAborted(signal, 'graph');
    const fileNodes = buildFileNodes(discovered, inventories);
    // Phase 4f T381: load the project's Python manifest ONCE per run so the
    // resolver can classify imports of declared dependencies (`flask`,
    // `pydantic`, etc.) as `external` rather than `unresolved`. The walk
    // probes pyproject.toml → setup.cfg → setup.py → requirements*.txt at
    // the project root (loadPythonManifest handles the fallback chain). When
    // no Python files exist we still load it once — the cost is one stat and
    // is amortised across the whole run.
    const pythonManifest = loadPythonManifestForRun(projectRoot, aggregate.filesByLang.py);
    graph = buildGraph({
      files: fileNodes,
      resolverContext: {
        projectRoot,
        ...(pythonManifest !== undefined ? { pythonManifest } : {}),
      },
    });
    emitter.emit({ kind: 'graph.done', edgeCount: graph.edges.length });
    checkAborted(signal, 'graph');
    filesScanned = inventories.size;
    // Build the FileId-keyed complexity map after graph assigns ids.
    const built = new Map<FileId, FileComplexity>();
    const builtByPath = new Map<string, FileComplexity>();
    for (const node of graph.files.values()) {
      const entry = inventories.get(node.path);
      if (entry !== undefined) {
        built.set(node.id, entry.complexity);
        builtByPath.set(node.path, entry.complexity);
      }
    }
    complexityMap = built;
    complexityByPath = builtByPath;
  }

  // Phase 4: analyze. Dispatch every enabled rule via the registry. The
  // dispatcher pre-computes the deterministic rule list so the
  // `analyze.start` event carries the accurate `ruleCount` before any rule
  // fires; each rule then emits an `analyze.progress` event keyed by RuleId.
  const fileNodesByPath = buildFileNodeIndex(graph);
  // Phase 3i Wave B — detect active plugins before assembling RuleContext
  // so `entryPoints` already reflects plugin contributions when the rule
  // dispatcher runs.
  const activePlugins = detectActivePluginsForRun(
    projectRoot,
    options.plugins,
    fileNodesByPath,
    options.config,
  );
  const entryPoints = resolveEntryPoints(
    options.config,
    projectRoot,
    activePlugins,
    fileNodesByPath,
  );
  const ruleCtx: RuleContext = {
    graph,
    fileNodes: fileNodesByPath,
    projectRoot,
    entryPoints,
    config: options.config,
    complexity: complexityMap,
    activePlugins,
  };
  const enabled = listEnabledRules(options.kind, options.config);
  emitter.emit({ kind: 'analyze.start', ruleCount: enabled.length });
  checkAborted(signal, 'analyze');
  const dispatch = runEnabledRules(ruleCtx, options.kind, options.config, (rule, n, total) => {
    emitter.emit({ kind: 'analyze.progress', rule, n, total });
  });
  const rawIssues: readonly DiscriminatedIssue[] = dispatch.issues;
  const actions: readonly AnalysisAction[] = [];
  emitter.emit({ kind: 'analyze.done' });
  checkAborted(signal, 'analyze');

  // Phase 5: cross-reference (3f.6) — files flagged unused-files short-circuit
  // their per-export / per-type / per-member findings before sort + emit.
  // Phase 3i Wave B extends the filter with active-plugin contributions:
  //  - `alwaysUsed` patterns suppress unused-files for matching paths.
  //  - `usedExports` rules suppress unused-exports per file pattern.
  //  - `toolingDependencies` are stripped from unused-deps / unused-dev-deps.
  const pluginFilters = buildPluginFilters(activePlugins, projectRoot);
  const crossRef = applyCrossReferenceFilter(rawIssues, pluginFilters);
  const issues = crossRef.issues;
  emitter.emit({ kind: 'crossref.done' });
  checkAborted(signal, 'crossref');

  // Phase 6 (Wave B): runtime intelligence — runs only when coverage was
  // supplied. The runtime layer is independent of the rule registry and
  // surfaces its findings via `RunAnalysisResult.runtime` rather than the
  // diagnostic stream.
  let runtimeReport: RuntimeReport | undefined;
  if (options.coverage !== undefined) {
    emitter.emit({ kind: 'runtime.start' });
    checkAborted(signal, 'runtime');
    const modulesByPath = new Set<string>();
    for (const node of graph.files.values()) modulesByPath.add(node.path);
    runtimeReport = runRuntime({
      coverage: options.coverage.input,
      modules: modulesByPath,
      complexityByPath,
      projectRoot,
      ...(options.coverage.root !== undefined ? { coverageRoot: options.coverage.root } : {}),
    });
    emitter.emit({ kind: 'runtime.done' });
    checkAborted(signal, 'runtime');
  }

  // Sort issues + actions deterministically.
  const sortedIssues = sortIssues(issues);
  const sortedActions = sortActions(actions);
  const determinismHash = computeDeterminismHash(sortedIssues, sortedActions);

  // Adjust per-rule diagnostic counts so the metrics reflect the post-filter
  // shape (the value the caller actually receives in `result.issues`).
  const adjustedByRule: Partial<Record<RuleId, number>> = { ...dispatch.diagnosticsByRule };
  for (const [rule, removed] of Object.entries(crossRef.filteredByRule)) {
    if (removed === undefined) continue;
    const ruleId = rule as RuleId;
    const before = adjustedByRule[ruleId] ?? 0;
    const after = before - removed;
    if (after <= 0) {
      delete adjustedByRule[ruleId];
    } else {
      adjustedByRule[ruleId] = after;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const metrics: AnalysisMetrics = {
    filesScanned,
    diagnosticsByRule: Object.freeze(adjustedByRule),
    elapsedMs,
    cacheHitRate: 0,
    entryPointsResolved: entryPoints.length,
    // Phase 4e T361: per-language file count and parse-error summary.
    // `Object.freeze` mirrors the rest of the metrics shape — every nested
    // object handed to the caller is deeply readonly.
    filesByLang: Object.freeze({ ts: filesByLang.ts, py: filesByLang.py }),
    parseErrors: Object.freeze({
      total: parseErrorTotal,
      byLang: Object.freeze({ ts: parseErrorByLang.ts, py: parseErrorByLang.py }),
    }),
  };

  const activePluginNames =
    activePlugins.length === 0 ? undefined : Object.freeze(activePlugins.map((p) => p.name));

  return Object.freeze({
    issues: sortedIssues,
    actions: sortedActions,
    metrics,
    progressEvents: emitter.collected(),
    ...(runtimeReport !== undefined ? { runtime: runtimeReport } : {}),
    ...(activePluginNames !== undefined ? { activePlugins: activePluginNames } : {}),
    _meta: Object.freeze({
      version: CORE_VERSION,
      mode: options.kind,
      determinismHash,
    }),
  }) satisfies RunAnalysisResult;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function validateOptions(options: RunAnalysisOptions): void {
  if (options === null || typeof options !== 'object') {
    throw new FugaziCoreError({
      code: 'CORE_INVALID_OPTIONS',
      message: 'runAnalysis: options must be a non-null object',
    });
  }
  if (typeof options.projectRoot !== 'string' || options.projectRoot.length === 0) {
    throw new FugaziCoreError({
      code: 'CORE_INVALID_OPTIONS',
      message: 'runAnalysis: projectRoot must be a non-empty string',
    });
  }
  if (!isAbsolute(options.projectRoot)) {
    throw new FugaziCoreError({
      code: 'CORE_INVALID_OPTIONS',
      message: `runAnalysis: projectRoot must be absolute, got "${options.projectRoot}"`,
    });
  }
  if (options.config === null || typeof options.config !== 'object') {
    throw new FugaziCoreError({
      code: 'CORE_INVALID_OPTIONS',
      message: 'runAnalysis: config must be a non-null object',
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Cancellation                                                                */
/* -------------------------------------------------------------------------- */

function checkAborted(signal: AbortSignal | undefined, phase: PhaseName): void {
  if (signal?.aborted === true) {
    throw new FugaziCoreError({
      code: 'CORE_ABORTED',
      message: `runAnalysis aborted at phase: ${phase}`,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                   */
/* -------------------------------------------------------------------------- */

const RECOGNIZED_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  // Phase 4c T361 + Phase 4e T362: Python sources and `.pyi` stub files are
  // discovered alongside TS/JS sources. extractOne dispatches `.py` / `.pyi`
  // to the tree-sitter-Python pipeline; everything else flows through SWC.
  '.py',
  '.pyi',
];

/**
 * Phase 4e T362: directories under which we never traverse for source files.
 * Extends Phase 3 default set with Python virtualenv conventions
 * (`.venv`, `venv`, `__pycache__`) and Python build artifacts so a Django or
 * FastAPI project's repo root doesn't pull every `site-packages/` file into
 * the discovery set.
 */
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.turbo',
  // Python virtualenvs + bytecode + build artifacts (Phase 4e T362).
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
]);

/**
 * Recursively walk `projectRoot` and return absolute POSIX paths to every
 * recognised TS/JS source file. Hidden directories are skipped except for the
 * config-allowlist (Phase 3c.1).
 *
 * `excludePatterns` (from `config.exclude`) is applied as a glob filter
 * against each candidate file's project-relative POSIX path. The default
 * patterns from the schema (`node_modules`, `dist`, `build`, `coverage`) are
 * already covered by `SKIPPED_DIRS`; this honours user-supplied glob patterns
 * such as `tests/conformance/fixtures/**` or `**\/dist/**`.
 */
async function discoverFiles(
  projectRoot: string,
  excludePatterns: readonly string[] | undefined,
): Promise<readonly string[]> {
  const out: string[] = [];
  await walkDir(projectRoot, out);
  let result = out.map(toPosix).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (excludePatterns !== undefined && excludePatterns.length > 0) {
    const rootPosix = toPosix(projectRoot);
    const rootPrefix = rootPosix.endsWith('/') ? rootPosix : `${rootPosix}/`;
    const globs = excludePatterns.filter(isGlobLike);
    if (globs.length > 0) {
      result = result.filter((path) => {
        const rel = path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path;
        for (const pattern of globs) {
          if (matchesGlob(pattern, rel)) return false;
        }
        return true;
      });
    }
  }
  return result;
}

async function walkDir(dir: string, out: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot === -1) continue;
      const ext = entry.name.slice(dot);
      if (RECOGNIZED_EXTENSIONS.includes(ext)) {
        out.push(full);
      }
    }
  }
}

function toPosix(p: string): string {
  return sep === '\\' ? p.replaceAll('\\', '/') : p;
}

/**
 * A glob-like string contains at least one of the wildcard or set characters
 * recognised by `matchesGlob`. Used by `resolveEntryPoints` to choose between
 * literal-path and glob-expansion treatment of a config entry.
 */
function isGlobLike(s: string): boolean {
  return s.includes('*') || s.includes('?') || s.includes('[') || s.includes('{');
}

function langForExtension(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')) {
    return 'ts';
  }
  return 'js';
}

/**
 * Phase 4e (T361/T370): coarse language bucket used by the per-language
 * dispatch in `extractOne` and the language-aware progress events. Every
 * recognised extension maps to either `'ts'` (the SWC pipeline; covers JS,
 * JSX, TS, TSX, .mts, .cts, .mjs, .cjs) or `'py'` (the tree-sitter-Python
 * pipeline; covers `.py` and `.pyi` stubs).
 */
function fileLang(path: string): 'ts' | 'py' {
  return path.endsWith('.py') || path.endsWith('.pyi') ? 'py' : 'ts';
}

/* -------------------------------------------------------------------------- */
/* Extract                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Per-file extract output: the shared `Inventory` consumed by the graph
 * builder plus the `FileComplexity` consumed by the health rules. Computed
 * together so the program/source pair is only held for one extract loop and
 * does not need a second parse pass. Phase 4e T361 adds:
 *   - `lang` — coarse language bucket (`'ts'` | `'py'`) for metrics.
 *   - `parseErrorCount` — the number of `ParseError` records emitted by the
 *     parser; soft-collected so the analysis pipeline never aborts.
 */
interface ExtractOutput {
  readonly inventory: Inventory;
  readonly complexity: FileComplexity;
  readonly lang: 'ts' | 'py';
  readonly parseErrorCount: number;
}

interface ExtractAggregate {
  readonly outputs: ReadonlyMap<string, ExtractOutput>;
  readonly filesByLang: { readonly ts: number; readonly py: number };
  readonly parseErrors: { readonly total: number; readonly byLang: { ts: number; py: number } };
}

async function extractInventories(
  paths: readonly string[],
  emitter: ProgressEmitter,
  signal: AbortSignal | undefined,
): Promise<ExtractAggregate> {
  const total = paths.length;
  const out = new Map<string, ExtractOutput>();
  let tsCount = 0;
  let pyCount = 0;
  let tsErrors = 0;
  let pyErrors = 0;
  // Throttle: emit ~20 progress ticks across the run, one per `step` files.
  const step = Math.max(1, Math.floor(total / 20));

  for (let i = 0; i < total; i++) {
    checkAborted(signal, 'extract');
    const path = paths[i] as string;
    const result = await extractOne(path);
    if (result !== null) {
      out.set(path, result);
      if (result.lang === 'py') {
        pyCount += 1;
        pyErrors += result.parseErrorCount;
      } else {
        tsCount += 1;
        tsErrors += result.parseErrorCount;
      }
    }
    const completed = i + 1;
    if (completed === total || completed % step === 0) {
      emitter.emit({ kind: 'extract.progress', n: completed, total });
    }
  }

  return {
    outputs: out,
    filesByLang: { ts: tsCount, py: pyCount },
    parseErrors: {
      total: tsErrors + pyErrors,
      byLang: { ts: tsErrors, py: pyErrors },
    },
  };
}

async function extractOne(path: string): Promise<ExtractOutput | null> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    return emptyExtract(fileLang(path));
  }
  // Phase 4e T361: full per-language dispatch. `.py` / `.pyi` route through
  // the tree-sitter-Python pipeline (parser → Python visitor → Python
  // complexity). Everything else flows through the SWC pipeline. Parse
  // errors are soft-collected per IMP-CORRECT-09 — the count surfaces in
  // `RunAnalysisResult.metrics.parseErrors` so consumers can render
  // "3 parse errors (2 in Python files)" without round-tripping the full
  // error array.
  if (path.endsWith('.py') || path.endsWith('.pyi')) {
    return extractOnePython(path, source);
  }
  let result: {
    readonly program: Awaited<ReturnType<typeof parse>>['program'];
    readonly errors: readonly ParseError[];
  };
  try {
    result = await parse(source, { filename: path, lang: langForExtension(path) });
  } catch {
    // Hard parser failure (e.g. WASM not loaded). Fail-soft per the
    // never-throws contract — represent the file as empty inventory.
    return emptyExtract('ts');
  }
  if (result.program === null) {
    return {
      inventory: emptyInventory(),
      complexity: emptyComplexity(),
      lang: 'ts',
      parseErrorCount: result.errors.length,
    };
  }
  const inventory = buildInventory(result.program);
  const complexity = computeComplexity(result.program, source);
  return { inventory, complexity, lang: 'ts', parseErrorCount: result.errors.length };
}

async function extractOnePython(path: string, source: string): Promise<ExtractOutput> {
  try {
    const result = await parsePythonAst(source, path);
    const inventory = buildPyInventory(result.program, source, path);
    const complexity = computeComplexityPy(result.program, source);
    return { inventory, complexity, lang: 'py', parseErrorCount: result.errors.length };
  } catch {
    // Fail-soft on hard parser failure (e.g. WASM not loaded).
    return emptyExtract('py');
  }
}

function emptyInventory(): Inventory {
  return Object.freeze({
    declarations: Object.freeze([]),
    imports: Object.freeze([]),
    usages: Object.freeze([]),
  });
}

function emptyComplexity(): FileComplexity {
  return Object.freeze({
    functions: Object.freeze([]),
    aggregate: Object.freeze({
      cyclomatic: 0,
      cognitive: 0,
      maintainabilityIndex: 100,
      loc: 0,
    }),
  });
}

function emptyExtract(lang: 'ts' | 'py'): ExtractOutput {
  return { inventory: emptyInventory(), complexity: emptyComplexity(), lang, parseErrorCount: 0 };
}

/* -------------------------------------------------------------------------- */
/* Python manifest                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Phase 4f T381: load the project's Python manifest at the project root,
 * once per run. Returns `undefined` when no Python files were discovered AND
 * no manifest file is present at the root, so the graph builder doesn't pay
 * for a no-op check on pure-TS projects. When at least one `.py` / `.pyi`
 * file is present we always load (and the resolver dispatcher consults the
 * result for every Python import).
 *
 * The walk uses `nodeFsAdapter` directly: `loadPythonManifest` is sync, never
 * throws on parse failure, and reads at most a handful of small files. Mixed
 * monorepos with multiple manifests keep the existing per-Python-file
 * resolver behaviour — manifest lookup is rooted at `projectRoot`, mirroring
 * how the TS rule walks to the nearest `package.json`. Phase 4 ships
 * project-root only; per-package manifest walks are a v1.x ask.
 */
function loadPythonManifestForRun(
  projectRoot: string,
  pyFileCount: number,
): PythonManifest | undefined {
  if (pyFileCount === 0) return undefined;
  const manifest = loadPythonManifest(toPosix(projectRoot), nodeFsAdapter);
  return manifest;
}

/* -------------------------------------------------------------------------- */
/* Graph build                                                                 */
/* -------------------------------------------------------------------------- */

function buildFileNodes(
  paths: readonly string[],
  inventories: ReadonlyMap<string, ExtractOutput>,
): readonly FileNode[] {
  // Re-sort defensively even though discoverFiles already path-sorts.
  const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ids = assignFileIds(sorted);
  const nodes: FileNode[] = [];
  for (const path of sorted) {
    const id = ids.get(path);
    if (id === undefined) continue;
    const entry = inventories.get(path);
    const inventory = entry !== undefined ? entry.inventory : emptyInventory();
    nodes.push({ id, path, inventory });
  }
  return nodes;
}

/* -------------------------------------------------------------------------- */
/* Rule-context assembly                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build the path → FileNode index that every rule consumes. Built once per
 * run so the dispatcher doesn't re-scan `graph.files` per rule.
 */
function buildFileNodeIndex(graph: Graph): ReadonlyMap<string, FileNode> {
  const out = new Map<string, FileNode>();
  for (const node of graph.files.values()) {
    out.set(node.path, node);
  }
  return out;
}

/**
 * Resolve `config.entrypoints` into absolute POSIX paths. The schema treats
 * the field as optional and the default is "no entry points declared" — the
 * unused-* rules early-return in that case.
 *
 * 3f.2 Wave 1 only resolves literal paths (no glob expansion). Glob-pattern
 * support lands when discovery is moved behind `@fugazi/config`'s
 * file-pattern API in a later phase. Relative paths are joined against
 * `projectRoot`; paths already absolute are normalised to POSIX-style
 * separators so they line up with the FileNode key set.
 */
function resolveEntryPoints(
  config: { readonly entrypoints?: readonly string[] | undefined },
  projectRoot: string,
  activePlugins: readonly PluginDef[],
  fileNodes: ReadonlyMap<string, FileNode>,
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (abs: string): void => {
    const norm = toPosix(abs);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  };

  // 1. User-declared entry points from config.entrypoints. Supports both
  //    literal paths and glob patterns. A "glob-like" entry is one that
  //    contains `*`, `?`, `[`, or `{` — those are expanded against the
  //    discovered file set; literal entries are pushed as-is so the
  //    no-discovery test paths still resolve.
  const raw = config.entrypoints;
  if (raw !== undefined) {
    const rootPosix = toPosix(projectRoot);
    const rootPrefix = rootPosix.endsWith('/') ? rootPosix : `${rootPosix}/`;
    for (const entry of raw) {
      if (isGlobLike(entry) && fileNodes.size > 0) {
        for (const node of fileNodes.values()) {
          const rel = node.path.startsWith(rootPrefix)
            ? node.path.slice(rootPrefix.length)
            : node.path;
          if (matchesGlob(entry, rel)) push(node.path);
        }
      } else {
        const abs = isAbsolute(entry) ? entry : join(projectRoot, entry);
        push(abs);
      }
    }
  }

  // 2. Plugin-contributed entry points. Each pattern is matched against
  // every discovered file's project-relative POSIX path. Matches enter the
  // entry-point set as absolute POSIX paths.
  if (activePlugins.length > 0 && fileNodes.size > 0) {
    const rootPosix = toPosix(projectRoot);
    const rootPrefix = rootPosix.endsWith('/') ? rootPosix : `${rootPosix}/`;
    for (const plugin of activePlugins) {
      for (const pattern of plugin.entryPoints) {
        for (const node of fileNodes.values()) {
          const rel = node.path.startsWith(rootPrefix)
            ? node.path.slice(rootPrefix.length)
            : node.path;
          if (matchesGlob(pattern, rel)) push(node.path);
        }
      }
    }
  }

  // 3. Zero-config inference fallback. When the user declared no explicit
  //    entry points, infer a sensible root set from conventions and manifests
  //    (package.json bin/main/exports, pyproject scripts, src/index, __main__,
  //    test files, …) so unconfigured projects still get accurate reachability.
  //    Purely additive on top of any plugin-contributed entries; skipped the
  //    moment the user takes control via config.entrypoints.
  const hasUserEntries = raw !== undefined && raw.length > 0;
  if (!hasUserEntries && fileNodes.size > 0) {
    for (const abs of inferEntryPoints(toPosix(projectRoot), fileNodes, nodeFsAdapter)) {
      push(abs);
    }
  }

  return out;
}

/**
 * Build the active-plugin list for this run. Honours the `options.plugins`
 * override when provided; otherwise loads the bundled set and merges the
 * config-driven external plugins / disables. Reads `<projectRoot>/package.json`
 * to assemble the dependency view; missing or malformed manifest activates no
 * plugins.
 */
function detectActivePluginsForRun(
  projectRoot: string,
  override: readonly PluginDef[] | undefined,
  fileNodes: ReadonlyMap<string, FileNode>,
  config: { readonly plugins?: unknown },
): readonly PluginDef[] {
  let plugins: readonly PluginDef[];
  if (override !== undefined) {
    plugins = override;
  } else {
    const cfgPlugins = config.plugins as
      | { readonly external?: readonly string[]; readonly disable?: readonly string[] }
      | undefined;
    const bundled = getBuiltinPlugins();
    const externals: PluginDef[] = [];
    for (const path of cfgPlugins?.external ?? []) {
      const abs = isAbsolute(path) ? path : join(projectRoot, path);
      try {
        externals.push(loadExternalPlugin(abs));
      } catch {
        // Skip malformed external plugins silently — the loader's verbatim
        // error message is logged separately by external tooling. The
        // analysis pipeline never fails-fast on a bad plugin.
      }
    }
    const disable = new Set(cfgPlugins?.disable ?? []);
    const merged: PluginDef[] = [];
    for (const p of bundled) if (!disable.has(p.name)) merged.push(p);
    for (const p of externals) if (!disable.has(p.name)) merged.push(p);
    plugins = merged;
  }
  const pkg = readPackageJsonForDetection(projectRoot);
  // The detector matches glob patterns against project-relative POSIX paths.
  const rootPosix = toPosix(projectRoot);
  const rootPrefix = rootPosix.endsWith('/') ? rootPosix : `${rootPosix}/`;
  const files: string[] = [];
  for (const node of fileNodes.values()) {
    const rel = node.path.startsWith(rootPrefix) ? node.path.slice(rootPrefix.length) : node.path;
    files.push(rel);
  }
  return detectActivePlugins(plugins, { pkg, files });
}

interface MinimalPackageJson {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

function readPackageJsonForDetection(projectRoot: string): MinimalPackageJson {
  const path = join(projectRoot, 'package.json');
  let raw: string;
  try {
    // Synchronous read intentionally — plugin activation runs once and the
    // file is small (median ~2KB).
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  const stringRecord = (v: unknown): Readonly<Record<string, string>> => {
    if (v === null || typeof v !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val;
    }
    return out;
  };
  return {
    dependencies: stringRecord(obj.dependencies),
    devDependencies: stringRecord(obj.devDependencies),
    peerDependencies: stringRecord(obj.peerDependencies),
  };
}

function buildPluginFilters(
  plugins: readonly PluginDef[],
  projectRoot: string,
): PluginCrossRefFilters {
  const alwaysUsed: string[] = [];
  const usedExports: { pattern: string; exports: readonly string[] }[] = [];
  const tooling = new Set<string>();
  const memberNames = new Set<string>();
  for (const plugin of plugins) {
    for (const pattern of plugin.alwaysUsed) alwaysUsed.push(pattern);
    for (const rule of plugin.usedExports) {
      usedExports.push({ pattern: rule.pattern, exports: rule.exports });
    }
    for (const dep of plugin.toolingDependencies) tooling.add(dep);
    for (const m of plugin.usedClassMembers) {
      if (typeof m === 'string') memberNames.add(m);
      // Scoped rules deferred — see Phase 3i scope-out note.
    }
  }
  return {
    alwaysUsedPatterns: Object.freeze(alwaysUsed),
    usedExportRules: Object.freeze(usedExports),
    toolingDependencies: tooling,
    usedClassMemberNames: memberNames,
    projectRootPosix: toPosix(projectRoot),
  };
}

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

function sortIssues(issues: readonly DiscriminatedIssue[]): readonly DiscriminatedIssue[] {
  return [...issues].sort(compareIssues);
}

function compareIssues(a: DiscriminatedIssue, b: DiscriminatedIssue): number {
  if (a.file < b.file) return -1;
  if (a.file > b.file) return 1;
  const aOff = byteOffsetOf(a.range);
  const bOff = byteOffsetOf(b.range);
  if (aOff !== bOff) return aOff - bOff;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  return 0;
}

function byteOffsetOf(range: Range | undefined): number {
  return range !== undefined ? range.start.byteOffset : -1;
}

function sortActions(actions: readonly AnalysisAction[]): readonly AnalysisAction[] {
  return [...actions].sort((a, b) => compareIssues(a.diagnostic, b.diagnostic));
}

/**
 * Compute SHA-256 over `JSON.stringify({ issues, actions })`. The hash is
 * stable across runs by construction: every nested array/object is already
 * sorted deterministically and `metrics.elapsedMs` is excluded by virtue of
 * not being part of the hashed object.
 */
function computeDeterminismHash(
  issues: readonly DiscriminatedIssue[],
  actions: readonly AnalysisAction[],
): string {
  const json = JSON.stringify({ issues, actions });
  return createHash('sha256').update(json).digest('hex');
}
