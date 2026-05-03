/**
 * matcher.ts — minimal glob → RegExp compiler (Phase 3i Wave A).
 *
 * Mirrors the inline matcher in `packages/core/src/rules/boundaries.ts` but
 * adds brace expansion (`{ts,tsx,js,jsx}`) and `?` single-char support so the
 * same compiler can handle both boundary zone patterns AND the broader plugin
 * pattern surface (e.g. nested glob globs with brace expansion).
 *
 * Why not picomatch? Two reasons:
 *
 *   1. Plugin patterns use a tightly-bounded subset (`*`, `**`, `?`, `{a,b}`).
 *      The implementation here is ~60 lines, no transitive deps, fully
 *      auditable and has zero install-time footprint.
 *   2. Determinism (NFR-1 / SC-15) is easier to guarantee against an inlined
 *      compiler than against a third-party library that may evolve its match
 *      semantics across minor versions.
 *
 * Supported pattern syntax:
 *
 *   - `*`         matches any run of non-`/` characters within a segment
 *   - `**`        matches any number of segments (including zero)
 *   - `?`         matches a single non-`/` character
 *   - `{a,b,c}`   matches any of the comma-separated alternatives. Nesting is
 *                 NOT supported — the porter never emits nested braces and the
 *                 plugin schema is not contractually required to either.
 *   - any other character is matched literally (regex meta escaped).
 *
 * Brace alternatives are expanded by emitting `(?:a|b|c)` into the regex.
 * Empty alternative `{a,}` is preserved as `(?:a|)` so optional suffixes work.
 *
 * The compiler is pure, synchronous, and never throws on a well-formed input.
 * Patterns with mismatched braces fall through to literal-character handling
 * (the `{` is escaped) so a malformed plugin never crashes the loader.
 */

const REGEX_META = new Set<string>(['.', '+', '(', ')', '[', ']', '|', '^', '$', '\\']);

/**
 * Compile a glob pattern to an anchored RegExp. The returned regex matches
 * the full input start-to-end so callers do not need to wrap with `^…$`.
 *
 * Determinism: the same input pattern always yields the same regex source.
 */
export function globToRegExp(pattern: string): RegExp {
  let body = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        // `**/` should match zero or more segments, INCLUDING the trailing
        // separator. Without the special-case, the literal `/` after `**`
        // forces at least one segment; consume it here so `app/**/page.ts`
        // matches `app/page.ts` as well as `app/a/b/page.ts`.
        if (pattern[i + 2] === '/') {
          body += '(?:.*/)?';
          i += 3;
        } else {
          body += '.*';
          i += 2;
        }
      } else {
        body += '[^/]*';
        i += 1;
      }
      continue;
    }
    if (ch === '?') {
      body += '[^/]';
      i += 1;
      continue;
    }
    if (ch === '{') {
      const end = pattern.indexOf('}', i + 1);
      if (end !== -1) {
        const inner = pattern.slice(i + 1, end);
        const parts = inner.split(',');
        const escaped = parts.map((part) => {
          let acc = '';
          for (const c of part) {
            if (c === '*' || c === '?' || c === '{' || c === '}' || c === '/') {
              // Bail on nested specials — escape literally.
              acc += REGEX_META.has(c) ? `\\${c}` : c;
              continue;
            }
            acc += REGEX_META.has(c) ? `\\${c}` : c;
          }
          return acc;
        });
        body += `(?:${escaped.join('|')})`;
        i = end + 1;
        continue;
      }
      // Unmatched brace — fall through to literal handling.
    }
    if (ch === undefined) {
      i += 1;
      continue;
    }
    body += REGEX_META.has(ch) ? `\\${ch}` : ch;
    i += 1;
  }
  return new RegExp(`^${body}$`);
}

/**
 * Test whether `path` (a project-relative POSIX path) matches `pattern`.
 *
 * Convenience wrapper around `globToRegExp` for one-shot use; callers that
 * test many paths against the same pattern should compile once and reuse.
 */
export function matchesGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}
