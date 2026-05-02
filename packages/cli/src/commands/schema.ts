import { FugaziConfigSchema } from '@fugazi/config';
/**
 * commands/schema.ts — Phase 3h.2 (T186) — `fugazi schema`.
 *
 * Prints the JSON schema derived from the canonical Zod schema
 * (`FugaziConfigSchema`). The default emits the JSON Schema document directly;
 * `--markdown` renders it as a Markdown table for human consumption.
 *
 * Determinism (NFR-1 / SC-15): byte-equal across runs. The JSON output uses
 * `JSON.stringify(..., null, 2)` (stable key order from Zod). The Markdown
 * renderer iterates over `properties` in alphabetical order.
 */
import { Command, Option } from 'clipanion';
import { z } from 'zod';

export class SchemaCommand extends Command {
  static override paths = [['schema']];
  static override usage = {
    description: 'Print the FugaziConfig JSON schema (or --markdown rendering)',
  };

  markdown = Option.Boolean('--markdown', false, {
    description: 'Render the schema as a Markdown table',
  });

  override async execute(): Promise<number> {
    const json = z.toJSONSchema(FugaziConfigSchema);
    if (this.markdown) {
      this.context.stdout.write(renderMarkdown(json));
    } else {
      this.context.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
    }
    return 0;
  }
}

/** Render a JSON Schema document as a small Markdown reference table. */
function renderMarkdown(schema: unknown): string {
  const lines: string[] = ['# Fugazi configuration schema', ''];
  if (!isObject(schema)) {
    lines.push('_(schema unavailable)_', '');
    return lines.join('\n');
  }
  const props = isObject(schema.properties) ? schema.properties : {};
  const keys = Object.keys(props).sort();
  lines.push('| field | type | description |', '| --- | --- | --- |');
  for (const key of keys) {
    const def = props[key];
    if (!isObject(def)) {
      lines.push(`| \`${key}\` | _unknown_ |  |`);
      continue;
    }
    const type = describeType(def);
    const description =
      typeof def.description === 'string' ? def.description.replace(/\|/g, '\\|') : '';
    lines.push(`| \`${key}\` | ${type} | ${description} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function describeType(def: Record<string, unknown>): string {
  if (typeof def.type === 'string') return def.type;
  if (Array.isArray(def.anyOf)) return 'union';
  if (Array.isArray(def.oneOf)) return 'union';
  if (def.enum !== undefined) return 'enum';
  return '_unknown_';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
