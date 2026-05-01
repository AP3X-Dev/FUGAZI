/**
 * loaders/toml.ts — TOML config loader (T037).
 *
 * Reads a `.toml` config file, strips a UTF-8 BOM if present (E3), and parses
 * via `smol-toml`. `smol-toml` is preferred over `@iarna/toml` because it is
 * pure ESM, smaller, and has zero dependencies.
 *
 * Returns the parsed structure as `unknown` for downstream Zod validation.
 *
 * Errors:
 *   - File missing → FugaziConfigError(code: 'CONFIG_FILE_NOT_FOUND')
 *   - Parse failure → FugaziConfigError(code: 'CONFIG_PARSE_FAILED')
 *
 * Verbatim error strings (per E5):
 *   - "Config file not found: <path>"
 *   - "Failed to parse TOML config at <path>"
 */
import { readFile } from 'node:fs/promises';
import { FugaziConfigError } from '@fugazi/types';
import { parse as parseToml } from 'smol-toml';

/**
 * Load and parse a TOML config file. Schema validation is the caller's job.
 */
export async function loadTomlConfig(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw new FugaziConfigError({
      code: 'CONFIG_FILE_NOT_FOUND',
      message: `Config file not found: ${path}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  // Strip UTF-8 BOM if present (E3).
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  try {
    return parseToml(text);
  } catch (cause) {
    throw new FugaziConfigError({
      code: 'CONFIG_PARSE_FAILED',
      message: `Failed to parse TOML config at ${path}`,
      context: { path },
      ...(cause instanceof Error ? { cause } : {}),
    });
  }
}
