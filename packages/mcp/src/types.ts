/**
 * types.ts — Phase 3h.4 (T195) — branded types and tool-result envelopes.
 *
 * Per FR-K3 / FR-K5 / IMP-API-10 / IMP-SEC-07 the MCP layer enforces a
 * read-only invariant at the type level: only `fix_apply` may mutate; the
 * other 14 tools are read-only. The brand symbols below make a `MutatingTool`
 * structurally incompatible with a `ReadOnlyTool` so a registry typed as
 * `readonly ReadOnlyTool<unknown, unknown>[]` rejects mutating tools at
 * compile time.
 *
 * Every tool result carries a `_meta` envelope (FR-K3 / F5 / IMP-API-10) with:
 *   - `schemaVersion` — bumped when the envelope shape changes.
 *   - `correlationId` — UUID per call; non-deterministic.
 *   - `progress`      — readonly snapshot of progress events.
 *   - `tookMs`        — wall-clock ms; non-deterministic.
 *
 * The non-deterministic fields are documented; tests that rely on byte-equal
 * output mock `crypto.randomUUID` and `performance.now`, or strip them before
 * comparison.
 */

import type { ZodType } from 'zod';

/* -------------------------------------------------------------------------- */
/* Result envelope                                                            */
/* -------------------------------------------------------------------------- */

export interface ToolMetaProgressEntry {
  readonly kind: string;
  readonly seq: number;
  readonly t: number;
}

export interface ToolMeta {
  readonly schemaVersion: 1;
  readonly correlationId: string;
  readonly progress: readonly ToolMetaProgressEntry[];
  readonly tookMs: number;
}

export interface ToolResultOk<T> {
  readonly data: T;
  readonly _meta: ToolMeta;
  readonly error?: false;
}

export interface ToolResultErr {
  readonly error: true;
  readonly message: string;
  /** FR-K4: MCP transport always succeeds; errors live in the payload. */
  readonly exit_code: 0;
  readonly _meta: ToolMeta;
}

export type ToolResult<T> = ToolResultOk<T> | ToolResultErr;

/* -------------------------------------------------------------------------- */
/* Read-only / mutating brands                                                */
/* -------------------------------------------------------------------------- */

declare const READ_ONLY_BRAND: unique symbol;
declare const MUTATING_BRAND: unique symbol;

export type ToolMode = 'read' | 'mutate';

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
}

/**
 * Brand types — `[BRAND]` is a phantom property: never assigned at runtime,
 * but required by the TypeScript structural type system so a `MutatingTool`
 * cannot satisfy `ReadOnlyTool` and vice versa. The brand has type
 * `unique symbol` whose only inhabitant is `undefined` after the cast in
 * `defineReadOnlyTool` / `defineMutatingTool`.
 */
export type ReadOnlyTool<I, O> = ToolDescriptor & {
  readonly mode: 'read';
  readonly schema: ZodType<I>;
  readonly handler: (input: I) => Promise<ToolResult<O>>;
  readonly [READ_ONLY_BRAND]: typeof READ_ONLY_BRAND;
};

export type MutatingTool<I, O> = ToolDescriptor & {
  readonly mode: 'mutate';
  readonly schema: ZodType<I>;
  readonly handler: (input: I) => Promise<ToolResult<O>>;
  readonly [MUTATING_BRAND]: typeof MUTATING_BRAND;
};

// Use `any` for Any*Tool input position because `unknown` is not contravariantly
// assignable from concrete input types — the registry just needs the brand and
// the runtime fields. The cast is structurally safe (handlers are validated
// behind `withValidation` and never see raw caller input directly).
// biome-ignore lint/suspicious/noExplicitAny: contravariant tool-input position.
export type AnyReadOnlyTool = ReadOnlyTool<any, unknown>;
// biome-ignore lint/suspicious/noExplicitAny: contravariant tool-input position.
export type AnyMutatingTool = MutatingTool<any, unknown>;
export type AnyTool = AnyReadOnlyTool | AnyMutatingTool;

interface DefineToolInput<I, O, M extends ToolMode> {
  readonly name: string;
  readonly description: string;
  readonly mode: M;
  readonly schema: ZodType<I>;
  readonly handler: (input: I) => Promise<ToolResult<O>>;
}

/**
 * Construct a read-only tool. The brand is implementation-private — callers
 * cannot forge a `ReadOnlyTool` from a plain object literal because the brand
 * key is `unique symbol` declared above.
 */
export function defineReadOnlyTool<I, O>(
  def: Omit<DefineToolInput<I, O, 'read'>, 'mode'>,
): ReadOnlyTool<I, O> {
  const out = {
    name: def.name,
    description: def.description,
    mode: 'read' as const,
    schema: def.schema,
    handler: def.handler,
  };
  // Brand symbol is type-only — the cast attaches the phantom brand.
  return Object.freeze(out) as unknown as ReadOnlyTool<I, O>;
}

export function defineMutatingTool<I, O>(
  def: Omit<DefineToolInput<I, O, 'mutate'>, 'mode'>,
): MutatingTool<I, O> {
  const out = {
    name: def.name,
    description: def.description,
    mode: 'mutate' as const,
    schema: def.schema,
    handler: def.handler,
  };
  return Object.freeze(out) as unknown as MutatingTool<I, O>;
}

/** Runtime brand checks — back-stop the type-level invariant. */
export function isReadOnlyTool(tool: AnyTool): tool is AnyReadOnlyTool {
  return tool.mode === 'read';
}

export function isMutatingTool(tool: AnyTool): tool is AnyMutatingTool {
  return tool.mode === 'mutate';
}
