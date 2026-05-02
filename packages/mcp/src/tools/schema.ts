/**
 * tools/schema.ts — Phase 3h.4 (T197) — `schema` tool.
 *
 * Read-only. Emits the JSON Schema document derived from `FugaziConfigSchema`.
 */

import { FugaziConfigSchema } from '@fugazi/config';
import { z } from 'zod';
import { buildMeta, wrapResult } from '../meta.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const SchemaArgs = z.object({});
export type SchemaArgsT = z.infer<typeof SchemaArgs>;

export interface SchemaResult {
  readonly jsonSchema: unknown;
}

export const schemaTool: ReadOnlyTool<SchemaArgsT, SchemaResult> = defineReadOnlyTool({
  name: 'schema',
  description: 'Return the FugaziConfig JSON schema.',
  schema: SchemaArgs,
  handler: async (): Promise<ToolResult<SchemaResult>> => {
    const json = z.toJSONSchema(FugaziConfigSchema);
    return wrapResult<SchemaResult>(Object.freeze({ jsonSchema: json }), buildMeta([]));
  },
});
