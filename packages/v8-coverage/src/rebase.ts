/**
 * rebase.ts — Phase 3e (T114-T115) — coverage-root URL rebase.
 *
 * Containers and CI runners commonly emit coverage with paths rooted under a
 * mount point that differs from the developer's host workspace (e.g. coverage
 * was collected inside `/app/` but tooling needs `/Users/me/project/`). This
 * module substitutes the from-prefix with the to-prefix on each ScriptCoverage
 * URL, then normalizes the result to forward-slash form with an upper-cased
 * Windows drive letter (so subsequent merges don't double-count).
 *
 * When `fromPrefix` doesn't match the URL, the entry is preserved verbatim
 * but flagged `unmapped: true` and a verbatim warning is logged to
 * `console.warn`. Callers may swallow the warning by spying on
 * `console.warn` if running in test contexts.
 *
 * NOTE: we deliberately do NOT call the async `canonicalize` helper here.
 * `canonicalize` is fs-touching (`realpath`) and would fail on URLs that no
 * longer exist on the host (a common situation for coverage from an old run).
 * The lighter-weight slash + drive-case folding below is sufficient for
 * URL-equality checks downstream.
 */

import type { ScriptCoverage } from './types.js';

export interface RebaseOptions {
  readonly fromPrefix: string;
  readonly toPrefix: string;
}

export interface RebasedScript extends ScriptCoverage {
  readonly unmapped?: boolean;
}

function normalizeUrl(url: string): string {
  let out = url;
  // Strip Windows verbatim prefix.
  if (out.startsWith('\\\\?\\')) {
    out = out.slice(4);
  }
  // Backslashes → forward slashes.
  if (out.includes('\\')) {
    out = out.replaceAll('\\', '/');
  }
  // For `file:///<drive>:/...` — uppercase drive letter for stable equality.
  // Match exactly file:///x:/ where x is a letter.
  if (out.startsWith('file:///') && out.length >= 10 && out[9] === ':') {
    const driveChar = out[8] ?? '';
    if (driveChar >= 'a' && driveChar <= 'z') {
      out = `file:///${driveChar.toUpperCase()}${out.slice(9)}`;
    }
  } else if (out.length >= 2 && out[1] === ':') {
    // Bare Windows path like `c:/foo`.
    const driveChar = out[0] ?? '';
    if (driveChar >= 'a' && driveChar <= 'z') {
      out = `${driveChar.toUpperCase()}${out.slice(1)}`;
    }
  }
  return out;
}

export function rebaseCoverage(
  scripts: readonly ScriptCoverage[],
  options: RebaseOptions,
): readonly RebasedScript[] {
  const { fromPrefix, toPrefix } = options;
  const out: RebasedScript[] = [];
  for (const s of scripts) {
    if (fromPrefix.length === 0) {
      // Identity rebase — still normalize the URL.
      out.push({
        scriptId: s.scriptId,
        url: normalizeUrl(s.url),
        functions: s.functions,
      });
      continue;
    }
    if (s.url.startsWith(fromPrefix)) {
      const replaced = `${toPrefix}${s.url.slice(fromPrefix.length)}`;
      out.push({
        scriptId: s.scriptId,
        url: normalizeUrl(replaced),
        functions: s.functions,
      });
    } else {
      // biome-ignore lint/suspicious/noConsole: spec-required verbatim warning (T115)
      console.warn(
        `v8-coverage: coverage-root prefix '${fromPrefix}' did not match URL '${s.url}'; entry kept unmapped`,
      );
      out.push({
        scriptId: s.scriptId,
        url: s.url,
        functions: s.functions,
        unmapped: true,
      });
    }
  }
  return out;
}
