/**
 * schema.ts — Zod schema for the on-disk Fugazi config (FugaziConfig).
 *
 * Two parallel schemas are exported:
 *
 *   - `FugaziConfigSchema`        — strict mode: unknown top-level keys are
 *                                    rejected with an `unrecognized_keys`
 *                                    issue. Used when the loaded config sets
 *                                    `strict: true`.
 *   - `FugaziConfigSchemaPermissive` — passthrough mode: unknown top-level
 *                                       keys flow through (the loader is
 *                                       responsible for warn-once). Used by
 *                                       default (`strict: false`).
 *
 * The split exists because the `strict` field on the config controls runtime
 * behaviour (warn-vs-throw on unknown keys), but Zod's `.strict()` /
 * `.passthrough()` modifiers are static. The loader picks the schema based on
 * the value of `strict` after a permissive first parse.
 *
 * Spec ref: design-doc §3.4 / §4.C.2 (config schema and precedence).
 * PRP refs: FR-B1 (file priority), FR-B2 (extends chain — `extends` field
 * is captured here; the loader implements the chain in T038/T039).
 */
import type { RuleId, Severity } from '@fugazi/types';
import { z } from 'zod';

/** Severity discriminated union — three closed values per @fugazi/types. */
const SeveritySchema: z.ZodType<Severity> = z.enum(['error', 'warn', 'off']);

/** RuleId enum — closed list per @fugazi/types `RuleId`. */
const RuleIdSchema: z.ZodType<RuleId> = z.enum([
  'unused-files',
  'unused-exports',
  'unused-types',
  'unused-deps',
  'unused-dev-deps',
  'unused-optional-deps',
  'unused-enum-members',
  'unused-class-members',
  'circular-dependencies',
  'boundary-violations',
  'unresolved-imports',
  'unlisted-dependencies',
  'duplicate-exports',
  'private-type-leak',
  'complexity-hotspot',
  'cognitive-complexity',
  'code-duplication',
  'cold-code',
  'hot-path',
]);

/** Default file-include glob — matches every TS/JS source extension. */
const DEFAULT_INCLUDE = ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'] as const;

/** Default exclude paths — common build/install/coverage output dirs. */
const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', 'coverage'] as const;

/**
 * Per-zone config used by the `boundary-violations` rule (Phase 3f.3 / T151).
 *
 *   - `pattern`    glob patterns matching files in this zone (relative to
 *                  `projectRoot`). First-match wins across zones during
 *                  classification — the rule iterates zones in insertion
 *                  order (alphabetical-key after JSON parse).
 *   - `canImport`  the zone names this zone is permitted to import from.
 *                  Empty array means "no out-of-zone imports allowed".
 */
const ZoneSchema = z.object({
  pattern: z.array(z.string()),
  canImport: z.array(z.string()),
});

/**
 * Per-rule health knobs used by the `complexity-hotspot` /
 * `cognitive-complexity` rules and the `--score` CLI flag (Phase 3f.5).
 *
 *   - `cyclomaticThreshold` strictly-greater threshold (default 10) above
 *                           which `complexity-hotspot` fires.
 *   - `cognitiveThreshold`  strictly-greater threshold (default 15) above
 *                           which `cognitive-complexity` fires.
 *   - `weights`             per-metric weights for the file-level score
 *                           (defaults: cyclomatic=0.3, cognitive=0.3, mi=0.4
 *                           — applied at the rule layer, not in the schema).
 *
 * Defaults are deliberately NOT set in the schema so existing config tests
 * that load minimal configs do not need to round-trip new fields.
 */
const HealthWeightsSchema = z.object({
  cyclomatic: z.number(),
  cognitive: z.number(),
  mi: z.number(),
});

const HealthSchema = z.object({
  cyclomaticThreshold: z.number().optional(),
  cognitiveThreshold: z.number().optional(),
  weights: HealthWeightsSchema.optional(),
});

/**
 * Build the shape used by both strict and permissive variants. Defining it
 * once guarantees they stay in lock-step.
 */
function buildShape() {
  return {
    /** Per-rule severity overrides (kebab-case rule id → severity). */
    rules: z.partialRecord(RuleIdSchema, SeveritySchema).default({}),
    /** Glob patterns for files to analyse. */
    include: z.array(z.string()).default([...DEFAULT_INCLUDE]),
    /** Glob patterns to exclude before analysis. */
    exclude: z.array(z.string()).default([...DEFAULT_EXCLUDE]),
    /** Optional explicit entry-point globs (in addition to detected ones). */
    entrypoints: z.array(z.string()).optional(),
    /**
     * Base configs to merge before this one. Either a single path/URL or an
     * array of them. Loader resolves and deep-merges per FR-B2 — bounded by
     * `MAX_EXTENDS_DEPTH=10`. The schema only captures the field; chain
     * resolution is implemented in T038/T039.
     */
    extends: z.union([z.string(), z.array(z.string())]).optional(),
    /** Framework preset names (react, next, vue, svelte, vitest, …). */
    frameworks: z.array(z.string()).optional(),
    /** When true, dev-only dependencies are reported as production-unused. */
    production: z.boolean().default(false),
    /**
     * When true, unknown top-level keys cause a hard validation error. When
     * false (default), unknown keys are kept and the loader emits a warn-once.
     */
    strict: z.boolean().default(false),
    /**
     * Opt-in to TypeScript-authored framework plugins (gated tier). Default
     * loads only bundled JSON plugins.
     */
    experimentalTsPlugins: z.boolean().default(false),
    /**
     * Boundary zones for the `boundary-violations` rule (Phase 3f.3 / T151).
     * Map of zone-name → `{ pattern, canImport }`. Optional; absence means no
     * boundary checks. Iteration order at classification time is alphabetical
     * by zone key (the natural order produced by JSON parse).
     */
    zones: z.record(z.string(), ZoneSchema).optional(),
    /**
     * Health-rule knobs (Phase 3f.5). Optional; rule-layer defaults apply
     * when missing or partially specified.
     */
    health: HealthSchema.optional(),
  } as const;
}

/**
 * Strict variant — unknown top-level keys are rejected with
 * `unrecognized_keys`. Used when the resolved config has `strict: true`.
 */
export const FugaziConfigSchema = z.object(buildShape()).strict();

/**
 * Permissive variant — unknown top-level keys are preserved in the parsed
 * output (passthrough). The loader is responsible for warn-once dedup.
 */
export const FugaziConfigSchemaPermissive = z.object(buildShape()).passthrough();

/** Inferred TypeScript type for FugaziConfig. */
export type FugaziConfig = z.infer<typeof FugaziConfigSchema>;
