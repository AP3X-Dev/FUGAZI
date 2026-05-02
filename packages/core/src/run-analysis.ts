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
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  type FileComplexity,
  type Inventory,
  type ParseError,
  buildInventory,
  computeComplexity,
  parse,
} from '@fugazi/extract';
import { type FileNode, type Graph, buildGraph } from '@fugazi/graph';
import {
  type DiscriminatedIssue,
  type FileId,
  FugaziCoreError,
  type Range,
  type RuleId,
  assignFileIds,
} from '@fugazi/types';
import { applyCrossReferenceFilter } from './cross-ref.js';
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

  let graph: Graph;
  let filesScanned: number;
  let complexityMap: ReadonlyMap<FileId, FileComplexity> = new Map();
  let complexityByPath: ReadonlyMap<string, FileComplexity> = new Map();

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
    const discovered = await discoverFiles(options.projectRoot);
    emitter.emit({ kind: 'discover.done', fileCount: discovered.length });
    checkAborted(signal, 'discover');

    // Phase 2: extract. Throttle progress emission to ~20 ticks total so
    // very large file sets don't flood the listener.
    emitter.emit({ kind: 'extract.start', total: discovered.length });
    checkAborted(signal, 'extract');
    const inventories = await extractInventories(discovered, emitter, signal);
    emitter.emit({ kind: 'extract.done' });
    checkAborted(signal, 'extract');

    // Phase 3: graph. Shared inventories flow forward (no JSON round-trip).
    emitter.emit({ kind: 'graph.start' });
    checkAborted(signal, 'graph');
    const fileNodes = buildFileNodes(discovered, inventories);
    graph = buildGraph({
      files: fileNodes,
      resolverContext: { projectRoot: options.projectRoot },
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
  const entryPoints = resolveEntryPoints(options.config, options.projectRoot);
  const ruleCtx: RuleContext = {
    graph,
    fileNodes: fileNodesByPath,
    projectRoot: options.projectRoot,
    entryPoints,
    config: options.config,
    complexity: complexityMap,
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
  const crossRef = applyCrossReferenceFilter(rawIssues);
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
      projectRoot: options.projectRoot,
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
  };

  return Object.freeze({
    issues: sortedIssues,
    actions: sortedActions,
    metrics,
    progressEvents: emitter.collected(),
    ...(runtimeReport !== undefined ? { runtime: runtimeReport } : {}),
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

const RECOGNIZED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo']);

/**
 * Recursively walk `projectRoot` and return absolute POSIX paths to every
 * recognised TS/JS source file. Hidden directories are skipped except for the
 * config-allowlist (Phase 3c.1).
 *
 * 3f.1 scaffolding only — full include/exclude glob handling per
 * `FugaziConfig.include`/`exclude` lands in 3f.2+ when discovery is moved
 * behind `@fugazi/config`'s file-pattern API.
 */
async function discoverFiles(projectRoot: string): Promise<readonly string[]> {
  const out: string[] = [];
  await walkDir(projectRoot, out);
  return out.map(toPosix).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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

function langForExtension(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')) {
    return 'ts';
  }
  return 'js';
}

/* -------------------------------------------------------------------------- */
/* Extract                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Per-file extract output: the shared `Inventory` consumed by the graph
 * builder plus the `FileComplexity` consumed by the health rules. Computed
 * together so the program/source pair is only held for one extract loop and
 * does not need a second parse pass.
 */
interface ExtractOutput {
  readonly inventory: Inventory;
  readonly complexity: FileComplexity;
}

async function extractInventories(
  paths: readonly string[],
  emitter: ProgressEmitter,
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, ExtractOutput>> {
  const total = paths.length;
  const out = new Map<string, ExtractOutput>();
  // Throttle: emit ~20 progress ticks across the run, one per `step` files.
  const step = Math.max(1, Math.floor(total / 20));

  for (let i = 0; i < total; i++) {
    checkAborted(signal, 'extract');
    const path = paths[i] as string;
    const result = await extractOne(path);
    if (result !== null) {
      out.set(path, result);
    }
    const completed = i + 1;
    if (completed === total || completed % step === 0) {
      emitter.emit({ kind: 'extract.progress', n: completed, total });
    }
  }

  return out;
}

async function extractOne(path: string): Promise<ExtractOutput | null> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    return emptyExtract();
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
    return emptyExtract();
  }
  if (result.program === null) {
    return emptyExtract();
  }
  const inventory = buildInventory(result.program);
  const complexity = computeComplexity(result.program, source);
  return { inventory, complexity };
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

function emptyExtract(): ExtractOutput {
  return { inventory: emptyInventory(), complexity: emptyComplexity() };
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
): readonly string[] {
  const raw = config.entrypoints;
  if (raw === undefined || raw.length === 0) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const abs = isAbsolute(entry) ? entry : join(projectRoot, entry);
    out.push(toPosix(abs));
  }
  return out;
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
