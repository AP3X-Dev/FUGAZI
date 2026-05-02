/**
 * rules/boundaries.ts — Phase 3f.3 (T151-T152) — boundary-violations rule.
 *
 * Detects layered-architecture violations: imports that cross from one zone
 * to another zone the source zone is not permitted to import from. Zones are
 * declared in `config.zones` as `{ <zoneName>: { pattern, canImport } }`.
 *
 *   - Each FileNode in `graph.files` is classified into at most one zone by
 *     glob-matching its project-relative path against each zone's `pattern[]`.
 *     Zones are iterated in insertion order (alphabetical by key after JSON
 *     parse) and first-match wins. Files that match no zone are skipped.
 *   - Each `Edge` with `to !== ROOT_FILE_ID` and `resolvable` is checked in
 *     isolation. If both endpoints have zones, the zones differ, and the
 *     target zone is NOT in `canImport[fromZone]`, the edge is reported.
 *   - Per-edge resolution: NO transitive closure. Each direct import edge is
 *     evaluated on its own.
 *
 * v1 limitation — re-export semantics:
 *   The plan calls out a re-export-aware interpretation (`a → b` re-exporting
 *   from `c` is "really an `a → c` import"). Implementing that requires
 *   per-symbol consumer tracking — the same per-symbol re-export hop the
 *   `unused-exports` rule defers. Wave 1 documented that limitation; this
 *   rule shares the same root cause and the same deferral.
 *
 *   In v1, only DIRECT edges are evaluated. When `a.ts` imports `b.ts` and
 *   `b.ts` re-exports from `c.ts`, two independent checks happen — `a → b`
 *   and `b → c` — and either may be a violation depending on config. The
 *   transitive `a → c` relationship is NOT traversed.
 *
 * Glob matching — minimal inline matcher (no new deps). Patterns supported:
 *   - exact path matches
 *   - `*`  matches any run of non-`/` characters within a path segment
 *   - `**` matches any number of segments (including zero)
 *   - any other character is matched literally
 *
 * Determinism (NFR-1 / SC-15):
 *   - Findings are emitted in path-sorted order over `graph.edges` (which is
 *     itself canonically sorted by `(from, to, kind, specifier)`).
 *   - The dispatcher re-sorts the union by `(file, byteOffset, kind)`; the
 *     per-rule sort is for debugging tractability per `RuleHandler` contract.
 */

import type { FileId, Graph } from '@fugazi/graph';
import type { BoundaryViolationsIssue, DiscriminatedIssue, Severity } from '@fugazi/types';
import { ROOT_FILE_ID } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'boundary-violations' as const;

interface ZoneSpec {
  readonly name: string;
  readonly patterns: readonly RegExp[];
  readonly canImport: ReadonlySet<string>;
}

/** Build the rule with the resolved severity threaded through. */
export function createBoundaryViolationsRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const zonesConfig = ctx.config.zones;
    if (zonesConfig === undefined) return [];
    const zoneNames = Object.keys(zonesConfig);
    if (zoneNames.length === 0) return [];

    const zones: ZoneSpec[] = [];
    for (const name of zoneNames) {
      const entry = zonesConfig[name];
      if (entry === undefined) continue;
      zones.push({
        name,
        patterns: entry.pattern.map(globToRegExp),
        canImport: new Set(entry.canImport),
      });
    }

    const fileToZone = classifyFiles(ctx.graph, zones, ctx.projectRoot);

    const issues: BoundaryViolationsIssue[] = [];
    for (const edge of ctx.graph.edges) {
      if (edge.to === ROOT_FILE_ID) continue;
      if (!edge.resolvable) continue;
      const fromZone = fileToZone.get(edge.from);
      if (fromZone === undefined) continue;
      const toZone = fileToZone.get(edge.to);
      if (toZone === undefined) continue;
      if (fromZone === toZone) continue;

      const allowed = findZone(zones, fromZone);
      if (allowed?.canImport.has(toZone)) continue;

      const fromNode = ctx.graph.files.get(edge.from);
      const toNode = ctx.graph.files.get(edge.to);
      if (fromNode === undefined || toNode === undefined) continue;

      issues.push(
        Object.freeze({
          kind: RULE_KIND,
          severity,
          file: fromNode.path,
          range: edge.loc,
          from: fromNode.path,
          to: toNode.path,
          fromZone,
          toZone,
          message: `boundary-violations: ${fromZone} may not import ${toZone}`,
        }) satisfies BoundaryViolationsIssue,
      );
    }

    issues.sort((a, b) => {
      if (a.file !== b.file) return a.file < b.file ? -1 : 1;
      const aOff = a.range.start.byteOffset;
      const bOff = b.range.start.byteOffset;
      if (aOff !== bOff) return aOff - bOff;
      return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
    });

    return issues as readonly DiscriminatedIssue[];
  };
}

function findZone(zones: readonly ZoneSpec[], name: string): ZoneSpec | undefined {
  for (const z of zones) {
    if (z.name === name) return z;
  }
  return undefined;
}

/**
 * Classify every FileNode into at most one zone. First-match wins across zones
 * iterated in insertion order. Paths are made project-relative before matching.
 */
function classifyFiles(
  graph: Graph,
  zones: readonly ZoneSpec[],
  projectRoot: string,
): Map<FileId, string> {
  const out = new Map<FileId, string>();
  for (const node of graph.files.values()) {
    const rel = relativize(node.path, projectRoot);
    const zone = matchZone(rel, zones);
    if (zone !== undefined) out.set(node.id, zone);
  }
  return out;
}

function matchZone(relPath: string, zones: readonly ZoneSpec[]): string | undefined {
  for (const z of zones) {
    for (const re of z.patterns) {
      if (re.test(relPath)) return z.name;
    }
  }
  return undefined;
}

/**
 * Strip `projectRoot` (and the trailing separator) from `path` to produce the
 * project-relative POSIX path used by glob matching. Inputs are expected to be
 * absolute POSIX paths from `FileNode.path`. If the path does not lie under
 * `projectRoot`, it is returned unchanged.
 */
function relativize(path: string, projectRoot: string): string {
  if (projectRoot.length === 0) return path;
  const root = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`;
  if (path === projectRoot) return '';
  if (path.startsWith(root)) return path.slice(root.length);
  return path;
}

/* -------------------------------------------------------------------------- */
/* Minimal glob matcher                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Compile a glob pattern to a `RegExp` that matches the pattern over the full
 * input (anchored start to end). Handles `**`, `*`, and literal characters.
 *
 *   - `**` becomes `.*`            — matches any number of segments
 *   - `*`  becomes `[^/]*`         — matches non-separator chars
 *   - `?`  becomes `[^/]`          — single non-separator char
 *   - any regex meta-character outside `*`/`?` is escaped
 *
 * The resulting regex is anchored (`^…$`) so callers do not need to wrap.
 */
function globToRegExp(pattern: string): RegExp {
  let body = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        body += '.*';
        i++;
      } else {
        body += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      body += '[^/]';
      continue;
    }
    if (ch === undefined) continue;
    if (REGEX_META.has(ch)) {
      body += `\\${ch}`;
    } else {
      body += ch;
    }
  }
  return new RegExp(`^${body}$`);
}

const REGEX_META = new Set<string>(['.', '+', '(', ')', '[', ']', '{', '}', '|', '^', '$', '\\']);
