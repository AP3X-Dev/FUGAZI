/**
 * schema.ts — Zod schemas for runtime plugin validation (Phase 3i Wave A).
 *
 * Mirrors the canonical `plugin-schema.json` schema definition. The schemas
 * exposed here are the runtime contract that every
 * bundled JSON data file under `src/data/` and every external plugin loaded
 * via `loadExternalPlugin()` must satisfy.
 *
 * Failure mode: invalid plugins surface a `ZodError` from `validatePlugin()`.
 * The loader catches and rewraps it into a `FugaziError` with the verbatim
 * message contract enforced by the consumer.
 *
 * Detection recursion: `PluginDetectionSchema` references itself via lazy
 * binding so the `all` / `any` combinators may nest arbitrarily deep. v1
 * does not bound the recursion depth — pathological inputs (10k-deep `all`)
 * are caller-controlled and out of scope.
 */

import { z } from 'zod';
import type {
  EntryPointRole,
  PluginDef,
  PluginDetection,
  PluginPackageManager,
  ScopedUsedClassMember,
  UsedClassMember,
  UsedExport,
} from './types.js';

/**
 * `EntryPointRoleSchema` — three closed values, defaults to `support` when
 * absent from the input. Matches `EntryPointRole` from `types.ts` 1:1.
 */
export const EntryPointRoleSchema: z.ZodType<EntryPointRole> = z.enum([
  'runtime',
  'test',
  'support',
]);

/**
 * `PluginPackageManagerSchema` — five closed values, defaults to `auto` when
 * absent from the input. Matches `PluginPackageManager` from `types.ts` 1:1.
 *
 * Phase 4d T346 — backwards-compatible addition. Existing TS plugins that
 * omit this field parse to `auto`, which checks both manifest pipelines.
 */
export const PluginPackageManagerSchema: z.ZodType<PluginPackageManager> = z.enum([
  'npm',
  'pip',
  'poetry',
  'uv',
  'auto',
]);

/**
 * `PluginDetectionSchema` — recursive discriminated-union over the four
 * detection strategies. Lazy so `all` / `any` may reference the schema itself.
 */
export const PluginDetectionSchema: z.ZodType<PluginDetection> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('dependency'), package: z.string() }),
    z.object({ type: z.literal('fileExists'), pattern: z.string() }),
    z.object({ type: z.literal('all'), conditions: z.array(PluginDetectionSchema) }),
    z.object({ type: z.literal('any'), conditions: z.array(PluginDetectionSchema) }),
  ]),
) as z.ZodType<PluginDetection>;

/**
 * `UsedExportSchema` — file-pattern + exports tuple. Both fields required.
 */
export const UsedExportSchema: z.ZodType<UsedExport> = z.object({
  pattern: z.string(),
  exports: z.array(z.string()),
});

/**
 * `ScopedUsedClassMemberSchema` — heritage-constrained class-member rule.
 * Both `extends` / `implements` are optional; `members` is required.
 *
 * Cast away the `string | undefined` Zod inference for optional fields so
 * the schema's output type matches `ScopedUsedClassMember` under
 * `exactOptionalPropertyTypes: true` (where `extends?: string` and
 * `extends?: string | undefined` are distinct).
 */
export const ScopedUsedClassMemberSchema = z.object({
  extends: z.string().optional(),
  implements: z.string().optional(),
  members: z.array(z.string()),
}) as unknown as z.ZodType<ScopedUsedClassMember>;

/**
 * `UsedClassMemberSchema` — either a plain string (global suppression) or a
 * scoped object. Zod's `union` is the natural shape for this anyOf.
 */
export const UsedClassMemberSchema: z.ZodType<UsedClassMember> = z.union([
  z.string(),
  ScopedUsedClassMemberSchema,
]);

/**
 * `PluginDefSchema` — the full declarative plugin shape. All list-typed
 * fields default to an empty array via `.default([])` so the parsed output
 * matches the readonly-everywhere `PluginDef` contract.
 *
 * The `name` field is the only hard required value.
 */
export const PluginDefSchema: z.ZodType<PluginDef> = z.object({
  name: z.string(),
  detection: PluginDetectionSchema.optional(),
  enablers: z.array(z.string()).default([]),
  entryPoints: z.array(z.string()).default([]),
  entryPointRole: EntryPointRoleSchema.default('support'),
  configPatterns: z.array(z.string()).default([]),
  alwaysUsed: z.array(z.string()).default([]),
  toolingDependencies: z.array(z.string()).default([]),
  usedExports: z.array(UsedExportSchema).default([]),
  usedClassMembers: z.array(UsedClassMemberSchema).default([]),
  packageManager: PluginPackageManagerSchema.default('auto'),
  usedDecorators: z.array(z.string()).default([]),
}) as unknown as z.ZodType<PluginDef>;
