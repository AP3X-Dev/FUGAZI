/**
 * loaders/json.ts — JSON / JSONC config loader (T033).
 *
 * Reads `.fugazirc.json` (or any JSON/JSONC path), strips a UTF-8 BOM if
 * present (per accepted divergence E3), and parses with `jsonc-parser` so
 * line/block comments and trailing commas are accepted. Returns the parsed
 * structure as `unknown` for downstream Zod validation.
 *
 * Errors:
 *   - File missing → FugaziConfigError(code: 'CONFIG_FILE_NOT_FOUND')
 *   - Parse failure → FugaziConfigError(code: 'CONFIG_PARSE_FAILED')
 *
 * Verbatim error strings (per E5):
 *   - "Config file not found: <path>"
 *   - "Failed to parse JSON config at <path>: <reason>"
 */
import { readFile } from 'node:fs/promises';
import { FugaziConfigError } from '@fugazi/types';
import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';

/**
 * Load and parse a JSON or JSONC config file into a plain JavaScript value.
 * Schema validation is performed by the caller.
 */
export async function loadJsonConfig(path: string): Promise<unknown> {
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

  // Strip UTF-8 BOM if the file was saved as UTF-8-with-signature (E3).
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const errors: ParseError[] = [];
  const parsed = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    const first = errors[0];
    const reason = first ? jsoncErrorReason(first) : 'unknown error';
    throw new FugaziConfigError({
      code: 'CONFIG_PARSE_FAILED',
      message: `Failed to parse JSON config at ${path}: ${reason}`,
      context: {
        path,
        errors: errors.map((e) => ({
          code: printParseErrorCode(e.error),
          offset: e.offset,
          length: e.length,
        })),
      },
    });
  }

  return parsed;
}

/**
 * Render a single jsonc-parser ParseError as a human-readable suffix that we
 * append to the verbatim "Failed to parse JSON config at <path>: " prefix.
 */
function jsoncErrorReason(err: ParseError): string {
  const code = printParseErrorCode(err.error);
  return `${code} at offset ${err.offset} (length ${err.length})`;
}
