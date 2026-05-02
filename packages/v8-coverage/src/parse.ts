/**
 * parse.ts — Phase 3e (T108-T109) — V8 ScriptCoverage JSON parser.
 *
 * Accepts both Node `--experimental-test-coverage` JSON output and Vitest
 * `coverage-v8` JSON output. The two share the Inspector ScriptCoverage shape;
 * tolerated differences:
 *   - Vitest sometimes wraps the dump as `{ result: [...] }` with extra keys
 *     such as `coverage-v8`; we accept any object whose top-level `result` is
 *     an array of ScriptCoverage entries.
 *   - Node emits integer columns; Vitest sometimes emits `column: null`. The
 *     parser does not inspect per-range positions — column normalization is
 *     the offset-mapper's job (offset-map.ts).
 *   - Some Node variants emit byte-offsets only (no line/column at all); some
 *     include line-based positions per range. Both are accepted.
 *
 * Validation rejects malformed entries with a verbatim error string of the
 * form `"v8-coverage: malformed input — <reason>"`. The reason is short and
 * fixture-asserted byte-for-byte (E5 / IMP-CORRECT-09).
 */

import { readFile } from 'node:fs/promises';
import { FugaziCoverageError } from '@fugazi/types';
import type { CoverageInput, FunctionCoverage, ScriptCoverage } from './types.js';

const ERR_PREFIX = 'v8-coverage: malformed input — ';

function fail(reason: string, cause?: unknown): never {
  const message = `${ERR_PREFIX}${reason}`;
  throw new FugaziCoverageError({
    code: 'COVERAGE_PARSE_MALFORMED',
    message,
    ...(cause instanceof Error ? { cause } : {}),
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateFunction(fn: unknown, scriptIdx: number, fnIdx: number): FunctionCoverage {
  if (!isObject(fn)) {
    return fail(`entry ${scriptIdx} function ${fnIdx} not an object`);
  }
  const functionName = fn.functionName;
  if (typeof functionName !== 'string') {
    return fail(`entry ${scriptIdx} function ${fnIdx} missing 'functionName'`);
  }
  const ranges = fn.ranges;
  if (!Array.isArray(ranges)) {
    return fail(`entry ${scriptIdx} function ${fnIdx} missing 'ranges' array`);
  }
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (!isObject(r)) {
      return fail(`entry ${scriptIdx} function ${fnIdx} range ${i} not an object`);
    }
    if (typeof r.startOffset !== 'number') {
      return fail(`entry ${scriptIdx} function ${fnIdx} range ${i} missing 'startOffset'`);
    }
    if (typeof r.endOffset !== 'number') {
      return fail(`entry ${scriptIdx} function ${fnIdx} range ${i} missing 'endOffset'`);
    }
    if (typeof r.count !== 'number') {
      return fail(`entry ${scriptIdx} function ${fnIdx} range ${i} missing 'count'`);
    }
  }
  // isBlockCoverage defaults to false when absent (matches Rust serde default).
  const isBlockCoverage = fn.isBlockCoverage;
  if (isBlockCoverage !== undefined && typeof isBlockCoverage !== 'boolean') {
    return fail(`entry ${scriptIdx} function ${fnIdx} 'isBlockCoverage' not a boolean`);
  }
  return {
    functionName,
    ranges: ranges.map((r) => {
      const obj = r as Record<string, unknown>;
      return {
        startOffset: obj.startOffset as number,
        endOffset: obj.endOffset as number,
        count: obj.count as number,
      };
    }),
    isBlockCoverage: isBlockCoverage === true,
  };
}

function validateScript(entry: unknown, idx: number): ScriptCoverage {
  if (!isObject(entry)) {
    return fail(`entry ${idx} not an object`);
  }
  const scriptId = entry.scriptId;
  if (typeof scriptId !== 'string') {
    return fail(`entry ${idx} missing 'scriptId'`);
  }
  const url = entry.url;
  if (typeof url !== 'string') {
    return fail(`entry ${idx} missing 'url'`);
  }
  const functions = entry.functions;
  if (!Array.isArray(functions)) {
    return fail(`entry ${idx} missing 'functions' array`);
  }
  const validatedFunctions: FunctionCoverage[] = [];
  for (let i = 0; i < functions.length; i++) {
    validatedFunctions.push(validateFunction(functions[i], idx, i));
  }
  return { scriptId, url, functions: validatedFunctions };
}

function validateInput(value: unknown): CoverageInput {
  if (!isObject(value)) {
    return fail('top-level not an object');
  }
  const result = value.result;
  if (!Array.isArray(result)) {
    return fail("missing 'result' array");
  }
  const scripts: ScriptCoverage[] = [];
  for (let i = 0; i < result.length; i++) {
    scripts.push(validateScript(result[i], i));
  }
  const out: { -readonly [K in keyof CoverageInput]: CoverageInput[K] } = { result: scripts };
  if (typeof value.timestamp === 'number') {
    out.timestamp = value.timestamp;
  }
  if (value['source-map-cache'] !== undefined) {
    out['source-map-cache'] = value['source-map-cache'];
  }
  return out;
}

export function parseCoverage(json: string): CoverageInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    return fail(
      `JSON parse error: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
  return validateInput(parsed);
}

export async function parseCoverageFile(path: string): Promise<CoverageInput> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw new FugaziCoverageError({
      code: 'COVERAGE_FILE_READ_FAILED',
      message: `v8-coverage: failed to read file '${path}'`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }
  return parseCoverage(text);
}
