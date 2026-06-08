# Architecture

This document explains how Fugazi works end to end: the analysis pipeline, the rule engine, the framework-plugin system, and the runtime-intelligence layer. It's written for contributors and for anyone who wants to understand the system in depth.

The mental model in one sentence: **discover → extract → graph** builds a faithful, language-agnostic model of a codebase; **rules** ask deterministic questions of that model; **plugins + cross-reference** inject framework knowledge so the answers are trustworthy; and the **runtime layer** optionally re-weights everything by what production actually does.

---

## 1. The pipeline

Every surface — CLI, LSP, MCP, the Node API — funnels into one function, `runAnalysis()` in `packages/core/src/run-analysis.ts`. It executes six phases in strict order and passes **live object references forward** (no JSON serialization between stages — that's both a performance and a determinism decision):

```
discover → extract → graph → analyze → cross-reference → runtime
   1          2         3        4            5             6
```

| Phase | Does | Key entry point |
| --- | --- | --- |
| **1. discover** | Walk the project root; enumerate `.ts/.tsx/.js/.jsx/.mts/.cts/.py/.pyi`; apply `config.exclude` globs. | `discoverFiles(projectRoot, exclude)` → `string[]` (absolute POSIX paths) |
| **2. extract** | Parse each file; build a per-file `Inventory` (declarations, imports, exports, usages) and `FileComplexity` (per-function metrics). Parse errors are soft-collected. | `extractInventories(files, emitter, signal)` |
| **3. graph** | Build the module dependency graph; resolve imports and re-export chains; assign stable, path-sorted `FileId`s. Loads the Python manifest once. | `buildGraph({ files, resolverContext })` → `Graph` |
| **4. analyze** | Dispatch the enabled detection rules against the graph; collect findings. | `runEnabledRules(ctx, mode, config)` |
| **5. cross-reference** | Collapse redundant findings; apply framework-plugin suppression. | `applyCrossReferenceFilter(issues, pluginFilters)` |
| **6. runtime** | *(optional)* If V8 coverage was supplied, produce the runtime report. | `runRuntime({ coverage, modules, complexityByPath, projectRoot })` |

Each phase checks the abort signal at its boundary, so a long run can be cancelled (e.g. by the LSP when the user keeps typing). The result, `RunAnalysisResult`, carries a `_meta.determinismHash` (SHA-256 over the sorted issues) that proves byte-identical output across runs.

### Parsers

Extraction uses WASM parsers: an oxc-based parser for TypeScript/JavaScript (with an swc-based fallback) and a tree-sitter grammar for Python. A parse cache keys on file content so unchanged files are skipped on re-runs. Single-file-component formats (Vue, Astro, MDX, plus CSS modules) have dedicated handlers that extract the embedded `<script>` blocks and route them through the same parser.

---

## 2. The data model

Three structures flow through the pipeline, defined in `@fugazi/types` and `@fugazi/extract`:

- **`Inventory`** (per file): every declaration, import, export, and usage the file contains. This is the raw material rules reason about.
- **`Graph`**: the project-wide module graph. Nodes are `FileNode`s (each holding that file's `Inventory`); edges are typed import/re-export relationships. File identity is a path-sorted `FileId` so the graph is reproducible.
- **`DiscriminatedIssue`**: the universal finding type (`packages/types/src/diagnostic.ts`). A base shape —

  ```ts
  interface Issue {
    readonly kind: RuleId;       // discriminant
    readonly severity: Severity; // 'error' | 'warn'
    readonly file: string;
    readonly range?: Range;      // { start, end } with byteOffset/line/col
    readonly message: string;
  }
  ```

  — plus one variant per rule that adds exactly the fields it needs:

  ```ts
  type CircularDependenciesIssue = Issue & { kind: 'circular-dependencies'; cycle: readonly string[] };
  type BoundaryViolationsIssue   = Issue & { kind: 'boundary-violations'; from: string; to: string; fromZone: string; toZone: string };
  type CodeDuplicationIssue      = Issue & { kind: 'code-duplication'; cloneType: 1|2|3|4; occurrences: readonly { file: string; range: Range }[] };
  ```

  Every part of the system — reporters, the LSP, the MCP server — speaks this one type.

---

## 3. The rule engine

This is the heart of the static layer, and it's deliberately a **registry, not a framework**.

### The contract

`packages/core/src/rules/registry.ts` exports `RULES: ReadonlyMap<RuleId, RuleFactory>`. The two-line type signature *is* the contract:

```ts
type RuleFactory = (severity: Severity) => RuleHandler;
type RuleHandler = (ctx: RuleContext) => readonly DiscriminatedIssue[];
```

A rule is a **pure function**: it receives one read-only `RuleContext` and returns a sorted array of issues. The rules:

- never mutate their inputs,
- never throw on hostile or malformed input (they skip and continue),
- emit in deterministic (path-sorted) order.

That uniformity is why a single rule file handles **both TypeScript and Python** — it iterates `graph.files` (which contains nodes of both languages) and branches on `node.path.endsWith('.py')` only where language-specific logic is genuinely needed.

### `RuleContext`

Assembled once per run, this is everything a rule could need:

```ts
interface RuleContext {
  readonly graph: Graph;                                   // frozen module graph
  readonly fileNodes: ReadonlyMap<string, FileNode>;       // path → node
  readonly projectRoot: string;
  readonly entryPoints: readonly string[];                 // config + plugin contributions
  readonly config: FugaziConfig;
  readonly complexity?: ReadonlyMap<FileId, FileComplexity>;
  readonly activePlugins?: readonly PluginDef[];
}
```

### Dispatch

`runEnabledRules(ctx, mode, config)` selects which rules run based on a `mode` (`full`, `dead-code-only`, `dupes-only`, `health-only`, or `audit`), drops any rule the user set to `off`, then invokes the factories **in alphabetical rule-id order** (sorted explicitly — not insertion order), collecting and re-sorting all issues by `(file, range.byteOffset, kind)`. It returns the issues plus a per-rule diagnostic count.

### The rules

Seventeen rules in three families:

**Dead code (14)** — reachability and structural correctness:

| Rule | How it works |
| --- | --- |
| `unused-files` | BFS reachability from entry points over all graph edges; unreachable files are flagged |
| `unused-exports` | exports on files with no incoming consumer edges |
| `unused-types` | type exports with no consumers (TS type kinds plus Python `TypedDict`/`Protocol`/`TypeAlias`/`NewType`) |
| `unused-deps` / `unused-dev-deps` / `unused-optional-deps` | manifest dependencies never imported |
| `unused-enum-members` / `unused-class-members` | members never referenced by any consumer of the parent |
| `circular-dependencies` | iterative Tarjan SCC; each cycle walked deterministically (lexicographically-smallest start, greedy-smallest next) |
| `boundary-violations` | classify files into zones by glob, then flag any edge that crosses zones not on the `canImport` allowlist |
| `unresolved-imports` / `unlisted-dependencies` / `duplicate-exports` | import hygiene against the resolver and the manifest |
| `private-type-leak` | a non-exported type surfaced through a public signature |

**Duplication (1)** — `code-duplication` wraps the standalone clone engine in `packages/core/src/dupes/`. `findAllClones` dispatches Type-1 (exact) → Type-2 (renamed) → Type-3 (near-miss) → Type-4 (reordered), with *subsumption* so a large clone family absorbs its sub-clones rather than reporting both.

**Health (2)** — `complexity-hotspot` and `cognitive-complexity` read the static `FileComplexity` computed in phase 2. If complexity wasn't computed (e.g. an LSP fast path), they cleanly emit nothing rather than failing. A separate `packages/core/src/health/` module aggregates per-file scores into a project score and a ranked list of refactor targets.

### Performance notes

- **No JSON round-trips** between phases — inventories, graph, and complexity flow forward as live references.
- Rules that share an expensive traversal (the three import-hygiene rules; the two member rules) **memoize** their candidate set on a `WeakMap` keyed by the `RuleContext`, so the walk happens once and is reused.

---

## 4. Cross-reference and the plugin system

Raw rule output contains redundancy and framework false-positives. Phase 5 (`packages/core/src/cross-ref.ts`) cleans both.

### Redundancy collapse

If a file is flagged `unused-files`, every `unused-exports` / `unused-types` / member finding *on that same file* is stripped — they're dead transitively, and reporting all of them is noise.

### Framework knowledge — supplied by plugins

A **plugin** (`packages/plugins/src/types.ts`, validated by a Zod `PluginDefSchema`) is a **declarative JSON file**. Around 120 ship under `packages/plugins/src/data/` — roughly 30 for Python frameworks plus JavaScript ones. Each encodes how a framework's "magic" should be treated:

| Field | Effect |
| --- | --- |
| `enablers` / `detection` | What activates the plugin: a dependency present in `package.json`/`pyproject.toml`, or a config file that exists. `detection` is a recursive `any`/`all`/`dependency`/`fileExists` union for richer logic. |
| `entryPoints` (+ `entryPointRole`) | Globs whose matches become **reachability roots**, so framework-invoked files (a Django `views.py`, a Next `page.tsx`) aren't seen as unreachable. The role (`runtime`/`test`/`support`) controls how a root counts. |
| `alwaysUsed` | Globs that suppress `unused-files` (e.g. `**/migrations/**.py`). |
| `usedExports` | Per-file export allowlists that suppress `unused-exports` (e.g. a framework-read `export metadata`). |
| `toolingDependencies` | Packages used implicitly, suppressing `unused-deps`. |
| `usedClassMembers` / `usedDecorators` | Members the framework calls and decorators that mark members live (`@pytest.fixture`, a Django model's `Meta`/`save`), suppressing `unused-class-members`. |

**How it wires in.** During phase 3, `runAnalysis` reads the manifests and calls `detectActivePlugins(...)`, keeping only plugins whose enablers match (npm names matched exactly or by `prefix/`; Python names normalized per PEP 503). Their `entryPoints` are merged into the reachability roots **before** rules run, so `unused-files` already knows about them. Their `alwaysUsed` / `usedExports` / `toolingDependencies` / `usedClassMembers` become the suppression sets applied in phase 5.

Plugins are loaded alphabetically and frozen at load; a malformed plugin is skipped rather than aborting the run — the same determinism and fail-soft discipline as the rest of the system. There's also an experimental tier for richer TypeScript-authored plugins behind the `experimentalTsPlugins` flag.

---

## 5. The runtime-intelligence layer

This is what makes Fugazi more than a static analyzer: it folds in **what actually executed**. It runs only when `runAnalysis` is given a V8 coverage blob (capture it with `fugazi coverage setup`).

Two packages cooperate: `@fugazi/v8-coverage` is the low-level normalizer; `packages/core/src/runtime/` is the analytics.

### `@fugazi/v8-coverage` — normalization

Turns raw output from `node --experimental-test-coverage` or a `coverage-v8` reporter into something usable, handling the messy realities:

| Module | Responsibility |
| --- | --- |
| `parse.ts` | Validate the JSON; tolerate `column: null` (some tools omit columns) and warn downstream |
| `offset-map.ts` | Map V8 byte offsets → line/column — UTF-8-aware (counts codepoints), BOM- and CRLF/CR-correct, O(log n) lookup |
| `script-id.ts` | Merge duplicate scripts from multi-worker runs — union ranges, sum hit counts |
| `rebase.ts` | Normalize file URLs (Windows verbatim prefixes, backslashes, drive-letter case) |
| `istanbul.ts` | Convert a `ScriptCoverage` into an Istanbul `FileCoverage`-shaped structure |

### `packages/core/src/runtime/` — the report

`runRuntime(...)` runs a six-step pipeline and returns a frozen `RuntimeReport`:

1. **rebase** coverage URLs onto project-relative paths — auto-detecting the common prefix against the known project files, and refusing (with a clear error) if it can't get a confident match.
2. **index** — build a dual-keyed `CoverageIndex` (`byFile` and `byFunction`).
3. **hot paths** (`hot-path.ts`) — aggregate hits per function, drop cold/uniform ones, take the top percentile. This is where the program actually spends its time.
4. **cold code** (`cold-code.ts`) — functions that were deployed but executed at or below a threshold (default 0): genuinely dead at runtime. Also reports files with no coverage at all.
5. **runtime-weighted health** (`weighted-health.ts`) — the key idea. Per function, `adjusted = cyclomatic × log₁₀(1 + hits)`, aggregated and normalized to a 0–100 score. A gnarly function that **runs constantly** becomes a high-priority refactor target; an equally-gnarly function that **never runs** is deprioritized (you should just delete it).
6. **assemble** the report:

```ts
interface RuntimeReport {
  readonly schemaVersion: 1;
  readonly hotPaths: readonly HotPathFinding[];
  readonly coldCode: readonly ColdCodeFinding[];
  readonly coverageMissing: readonly string[];
  readonly weightedRefactorTargets: readonly RefactorTarget[];
}
```

### Why it's a sibling report

Runtime findings are surfaced as `RunAnalysisResult.runtime`, **not** merged into the static `issues` stream. The static rules stay pure — coverage is outside `RuleContext`'s scope — and the reporter layer maps runtime findings into the shared `DiscriminatedIssue` shape at presentation time. Trends and alerts are framed as deltas and thresholds computed over these per-run reports.

---

## 6. The determinism contract

Every subsystem obeys one law: **the same input produces byte-identical output, on every machine.** Concretely:

- File IDs are **path-sorted**; the graph is reproducible.
- Rules are dispatched in **alphabetical** order; plugins are loaded in **alphabetical** order.
- All returned structures are **frozen**, and every sort has an explicit, total tiebreaker.
- There is **no `Date.now()` and no `Math.random()`** in any analysis path; non-deterministic fields (elapsed time, content hashes) are stripped before comparison.
- All reporter formats serialize deterministically.

This is what lets the conformance suite assert byte-equality of analyzer output against frozen snapshots, and it's what makes Fugazi safe to wire into CI as a hard gate.

---

## 7. How the surfaces connect

The CLI, LSP, MCP server, and Node API are thin adapters over the same `runAnalysis()`:

- **CLI** (`fugazi`) parses arguments, picks the analysis `mode`, runs the pipeline against the current directory, and prints findings through the selected reporter.
- **LSP** (`fugazi-lsp`) re-runs (often via fast paths that skip complexity) on document changes, maps `DiscriminatedIssue`s to diagnostics, and offers code actions (e.g. inserting a suppression comment).
- **MCP** (`fugazi-mcp`) exposes the analyzer as tools over stdio so an agent can request analysis and receive structured findings, each wrapped in a `_meta` envelope.
- **Node API** (`@fugazi/node`) is the library entry: `analyze(...)` and focused helpers returning the same result type.

Because they all share the pipeline and the one finding type, behavior is identical across surfaces — by construction.
