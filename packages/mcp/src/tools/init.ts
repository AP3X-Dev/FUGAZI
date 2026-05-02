/**
 * tools/init.ts — Phase 3h.4 (T197) — `init` tool.
 *
 * Writes `.fugazirc.json` at `projectRoot`. Refuses overwrite without
 * `force: true`; the refusal message is verbatim:
 *
 *   `init: .fugazirc.json already exists; pass force: true to overwrite`
 *
 * NOTE: this is one of two file-touching read-mode tools — it writes the
 * config file but does NOT modify project source. The `mode: 'read'` brand
 * still applies because the read/mutate distinction in IMP-SEC-07 tracks
 * **source-code mutations**, not config-file initialisation.
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectFrameworks } from '@fugazi/config';
import { z } from 'zod';
import { buildMeta, wrapError, wrapResult } from '../meta.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const InitArgs = z.object({
  projectRoot: z.string().min(1),
  force: z.boolean().optional(),
});

export type InitArgsT = z.infer<typeof InitArgs>;

export interface InitResult {
  readonly path: string;
  readonly bytesWritten: number;
}

const REFUSAL_MESSAGE = 'init: .fugazirc.json already exists; pass force: true to overwrite';

export const initTool: ReadOnlyTool<InitArgsT, InitResult> = defineReadOnlyTool({
  name: 'init',
  description: 'Write .fugazirc.json with detected framework presets.',
  schema: InitArgs,
  handler: async (input): Promise<ToolResult<InitResult>> => {
    const target = join(input.projectRoot, '.fugazirc.json');
    if (existsSync(target) && input.force !== true) {
      return wrapError(REFUSAL_MESSAGE, buildMeta([]));
    }
    const frameworks = await detectFrameworks(input.projectRoot);
    const body = renderTemplate(frameworks);
    await writeFile(target, body, 'utf8');
    return wrapResult<InitResult>(
      Object.freeze({ path: target, bytesWritten: Buffer.byteLength(body, 'utf8') }),
      buildMeta([]),
    );
  },
});

/** JSONC template — byte-equal output for identical inputs. */
function renderTemplate(frameworks: readonly string[]): string {
  const frameworksJson =
    frameworks.length === 0 ? '[]' : `[${frameworks.map((f) => JSON.stringify(f)).join(', ')}]`;
  return [
    '// Fugazi configuration. JSONC syntax (comments + trailing commas allowed).',
    '// Run `fugazi schema` for the full field reference.',
    '{',
    '  // Per-rule severity overrides. Defaults are "error".',
    '  "rules": {},',
    '',
    '  // File patterns analysed. Default covers every TS/JS source extension.',
    '  "include": ["**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"],',
    '',
    '  // File patterns excluded before analysis.',
    '  "exclude": ["node_modules", "dist", "build", "coverage"],',
    '',
    '  // Detected framework presets (auto-populated from package.json).',
    `  "frameworks": ${frameworksJson},`,
    '',
    '  // Boundary zones for the boundary-violations rule. Empty by default.',
    '  "zones": {},',
    '',
    '  // Reject unknown top-level keys when true.',
    '  "strict": false',
    '}',
    '',
  ].join('\n');
}
