/**
 * exports-conditions.ts — package.json `exports` field resolution.
 *
 * Implements the subset of the Node.js `exports` algorithm needed for static
 * analysis:
 *
 *   - String exports: `"./mod.js"` -> resolve `./mod.js` relative to the
 *     package root.
 *   - Object exports keyed by subpath: `{ "./foo": "./src/foo.js" }`.
 *   - Conditional exports: `{ "import": "./esm/index.js", "require": "./cjs/index.js" }`.
 *     Conditions are matched in declaration order; the first key whose
 *     condition is in the active set wins. The default condition order is
 *     configurable via the resolver context.
 *   - Subpath patterns: keys with a single `*` capture the tail and substitute
 *     into the matched value (Node's "Subpath patterns" spec).
 *   - Nested condition objects: an object value is recursively matched.
 *
 * Returns the resolved sub-path within the package, OR null when the export
 * is unmatched. The caller joins the result to the package root and probes.
 */

/**
 * Default condition order. Per the dispatch contract, `default` is a
 * universal fallback so it sits last.
 *
 * Note: the resolver lists `default` first in this array; the dispatch logic
 * treats it as a universal fallback regardless of position. Tests cover both
 * ordering cases via the configurable list.
 */
export const DEFAULT_CONDITIONS: readonly string[] = Object.freeze([
  'default',
  'node',
  'import',
  'require',
]);

interface MatchedExport {
  readonly subpath: string;
  /**
   * The matched key (debug aid; not consumed by the caller). Always the
   * leaf key, not the parent condition path.
   */
  readonly key: string;
}

/**
 * Match a single `exports` value (string | object | array) against the
 * active condition set. Returns the resolved subpath relative to the
 * package root, or `null` on no-match.
 */
function matchValue(
  value: unknown,
  conditions: readonly string[],
  tail: string,
): MatchedExport | null {
  if (typeof value === 'string') {
    const substituted = value.includes('*') ? value.replaceAll('*', tail) : value;
    return { subpath: substituted, key: '' };
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const m = matchValue(entry, conditions, tail);
      if (m !== null) return m;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    // Iterate in declaration order; the first matching condition wins.
    for (const [k, v] of Object.entries(value)) {
      if (k === 'default' || conditions.includes(k)) {
        const m = matchValue(v, conditions, tail);
        if (m !== null) return { subpath: m.subpath, key: k };
      }
    }
    return null;
  }
  return null;
}

interface PatternMatch {
  readonly tail: string;
  readonly score: number;
}

function matchPattern(pattern: string, subpath: string): PatternMatch | null {
  const star = pattern.indexOf('*');
  if (star === -1) {
    if (pattern === subpath) return { tail: '', score: pattern.length };
    return null;
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return null;
  if (subpath.length < prefix.length + suffix.length) return null;
  return {
    tail: subpath.slice(prefix.length, subpath.length - suffix.length),
    score: prefix.length + suffix.length,
  };
}

/**
 * Resolve a subpath against a package.json `exports` field.
 *
 * @param exportsField  The raw `exports` value (string | object).
 * @param subpath       The subpath being requested. Use `'.'` for the
 *                      package root entry, otherwise prefix with `./` (e.g.
 *                      `./components`).
 * @param conditions    Active condition order.
 * @returns             The resolved subpath (relative to package root) or
 *                      `null` when the export does not match.
 */
export function resolveExports(
  exportsField: unknown,
  subpath: string,
  conditions: readonly string[],
): string | null {
  if (exportsField === null || exportsField === undefined) return null;

  // Sugar: a bare string `exports` means "main entry".
  if (typeof exportsField === 'string') {
    if (subpath === '.' || subpath === './') {
      return exportsField;
    }
    return null;
  }

  if (Array.isArray(exportsField)) {
    const matched = matchValue(exportsField, conditions, '');
    if (matched === null) return null;
    if (subpath === '.' || subpath === './') return matched.subpath;
    return null;
  }

  if (typeof exportsField !== 'object') return null;
  const map = exportsField as Record<string, unknown>;

  // Heuristic: if every key starts with `.`, it's a subpath map; otherwise
  // it's a flat condition object that applies to the package root.
  const keys = Object.keys(map);
  const isSubpathMap = keys.every((k) => k.startsWith('.'));

  if (!isSubpathMap) {
    if (subpath !== '.' && subpath !== './') return null;
    const matched = matchValue(map, conditions, '');
    return matched === null ? null : matched.subpath;
  }

  // Subpath map. Match exact key first, then patterns (longest wins).
  const directValue = map[subpath];
  if (directValue !== undefined) {
    const matched = matchValue(directValue, conditions, '');
    return matched === null ? null : matched.subpath;
  }

  let best: { value: unknown; tail: string; score: number } | null = null;
  for (const key of keys) {
    if (!key.includes('*')) continue;
    const m = matchPattern(key, subpath);
    if (m === null) continue;
    if (best === null || m.score > best.score) {
      best = { value: map[key], tail: m.tail, score: m.score };
    }
  }
  if (best !== null) {
    const matched = matchValue(best.value, conditions, best.tail);
    return matched === null ? null : matched.subpath;
  }
  return null;
}
