/**
 * asset-url.ts — Phase 3c.4 Dispatch C-1 (T066) — asset-URL pattern detector.
 *
 * Pure structural inspectors for the canonical bundler asset-edge pattern:
 *
 *   new URL('./img.png', import.meta.url)
 *
 * Recognised by Vite, Webpack, Rollup, esbuild, and Bun: the bundler treats
 * the literal first argument as a relative path to a static asset, copies it
 * into the output, and rewrites the constructor call to a runtime URL pointing
 * at the emitted file. From a static-analysis perspective this is an EDGE in
 * the module graph — the literal is a module-like specifier whose target is a
 * real on-disk file Fugazi must follow during dead-code analysis.
 *
 * The detector is intentionally STRICT: only the exact `new URL(<string>,
 * import.meta.url)` shape matches. False positives like `new URL(href)`,
 * `new myURL('./x', import.meta.url)`, or `new URL('./x', otherBase)` return
 * `null`. The strictness is deliberate — a missed asset edge is fixable in a
 * follow-up wave; a spurious edge causes resolver thrash.
 *
 * Per IMP-DEBT-08: this module operates exclusively on Fugazi's discriminated-
 * union AST (no string sentinels, no parser-engine specifics).
 */

import type { Expression, NewExpression } from './ast/kinds.js';

/**
 * Returned when `matchAssetUrl` recognises the canonical asset-URL shape.
 * `source` carries the verbatim first-argument string literal — relative paths
 * remain relative, leading `./` is preserved, no normalisation is applied.
 * `resolvable` is always `true`: a string literal is by definition resolvable.
 */
export interface AssetUrlMatch {
  readonly source: string;
  readonly resolvable: true;
}

/**
 * Returns true when `node` is the MemberExpression form `import.meta.url`.
 * Pure shape check — no side effects, no recursion. Used by `matchAssetUrl`
 * to validate the second argument of `new URL(literal, import.meta.url)`.
 */
export function isImportMetaUrl(node: Expression): boolean {
  if (node.kind !== 'MemberExpression') return false;
  if (node.object.kind !== 'ImportMeta') return false;
  if (node.property.name !== 'url') return false;
  return true;
}

/**
 * Inspect a `NewExpression` for the canonical asset-URL shape. Returns the
 * `AssetUrlMatch` when ALL of the following hold:
 *
 *   - `node.callee` is an `Identifier` whose name is exactly `'URL'`
 *     (case-sensitive — `myURL`, `urlLib.URL`, `URLSearchParams` reject)
 *   - `node.args[0]` is a `Literal` whose value is a `string`
 *   - `node.args[1]` is a `MemberExpression` matching `import.meta.url`
 *
 * Otherwise returns `null`. Never throws.
 */
export function matchAssetUrl(node: NewExpression): AssetUrlMatch | null {
  if (node.callee.kind !== 'Identifier') return null;
  if (node.callee.name !== 'URL') return null;
  if (node.args.length < 2) return null;
  const first = node.args[0];
  const second = node.args[1];
  if (first === undefined || second === undefined) return null;
  if (first.kind !== 'Literal') return null;
  if (typeof first.value !== 'string') return null;
  if (!isImportMetaUrl(second)) return null;
  return { source: first.value, resolvable: true };
}
