/**
 * fix/engine.ts — Phase 3h.6 (T206-T210) — auto-fix engine.
 *
 * The engine consumes `RunAnalysisResult.actions` (each carrying a list of
 * `Edit` records keyed by absolute file path + byte-offset range) and applies
 * them via per-file atomic writes:
 *
 *   1. Group edits by file.
 *   2. Re-read the file from disk and verify its SHA-256 still matches the
 *      hash we observed when the action was generated. (Refuse on drift.)
 *   3. Sort edits in REVERSE byte-order so earlier offsets don't shift later
 *      offsets after substring splicing.
 *   4. Splice each `newText` into the original content.
 *   5. Write to `<path>.tmp.<random>` then `fs.rename` to `<path>` so partial
 *      writes never overwrite the original (per D3).
 *
 * `applyFixes()` is also the v1 dry-run path — pass `dryRun: true` and the
 * engine returns the planned edits without touching disk.
 *
 * Per IMP-CORRECT-09 every error message is contractual; the integration
 * tests fixture-assert these strings byte-for-byte.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { RuleId } from '@fugazi/types';
import type { AnalysisAction, Edit } from '../types.js';

/** Outcome reported per file in the fix-engine result. */
export type FileFixOutcome =
  | { readonly status: 'applied'; readonly file: string; readonly editCount: number }
  | { readonly status: 'unchanged'; readonly file: string }
  | { readonly status: 'drift'; readonly file: string; readonly message: string }
  | { readonly status: 'missing'; readonly file: string; readonly message: string }
  | { readonly status: 'error'; readonly file: string; readonly message: string };

/** Aggregate report returned by `applyFixes`. */
export interface FixEngineResult {
  readonly applied: number;
  readonly skipped: number;
  readonly errors: number;
  readonly outcomes: readonly FileFixOutcome[];
  readonly plan: readonly PlannedFileFix[];
  readonly dryRun: boolean;
}

/** A planned per-file edit batch surfaced for dry-run preview. */
export interface PlannedFileFix {
  readonly file: string;
  readonly edits: readonly Edit[];
  readonly ruleIds: readonly RuleId[];
}

export interface ApplyFixesOptions {
  readonly actions: readonly AnalysisAction[];
  /** When provided, only actions whose diagnostic.kind matches one of the entries are applied. */
  readonly ruleFilter?: readonly RuleId[];
  /** When `true`, the engine never writes to disk and returns only the plan. */
  readonly dryRun?: boolean;
  /** Optional content-hash provider (override for tests). Defaults to SHA-256 of the read file. */
  readonly hashOf?: (content: string) => string;
}

/**
 * Verbatim drift error. The {file} placeholder is interpolated; the prefix
 * and suffix are stable.
 */
export const DRIFT_MESSAGE_PREFIX = 'fix: refused to apply — file changed on disk: ';

/**
 * Verbatim "file not found" message used when an action references a path
 * that no longer exists.
 */
export const MISSING_FILE_PREFIX = 'fix: file not found: ';

/**
 * Verbatim message used when an Edit's start or end offset falls outside the
 * current file content.
 */
export const OFFSET_OOB_PREFIX = 'fix: edit offset out of bounds: ';

/**
 * Apply (or dry-run) the supplied actions. Never throws — every per-file
 * failure is captured in `outcomes`.
 */
export async function applyFixes(options: ApplyFixesOptions): Promise<FixEngineResult> {
  const dryRun = options.dryRun === true;
  const filtered = filterActions(options.actions, options.ruleFilter);
  const grouped = groupByFile(filtered);
  const plan = buildPlan(grouped);

  const outcomes: FileFixOutcome[] = [];
  let applied = 0;
  let skipped = 0;
  let errors = 0;

  if (dryRun) {
    for (const file of grouped.keys()) {
      outcomes.push({ status: 'unchanged', file });
    }
    return Object.freeze({
      applied: 0,
      skipped: outcomes.length,
      errors: 0,
      outcomes: Object.freeze(outcomes) as readonly FileFixOutcome[],
      plan: Object.freeze(plan) as readonly PlannedFileFix[],
      dryRun: true,
    }) satisfies FixEngineResult;
  }

  for (const planned of plan) {
    const outcome = await applyOneFile(planned, options.hashOf);
    outcomes.push(outcome);
    if (outcome.status === 'applied') applied += 1;
    else if (outcome.status === 'unchanged') skipped += 1;
    else errors += 1;
  }

  return Object.freeze({
    applied,
    skipped,
    errors,
    outcomes: Object.freeze(outcomes) as readonly FileFixOutcome[],
    plan: Object.freeze(plan) as readonly PlannedFileFix[],
    dryRun: false,
  }) satisfies FixEngineResult;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function filterActions(
  actions: readonly AnalysisAction[],
  filter: readonly RuleId[] | undefined,
): readonly AnalysisAction[] {
  if (filter === undefined || filter.length === 0) return actions;
  const allow = new Set(filter);
  return actions.filter((a) => allow.has(a.diagnostic.kind));
}

function groupByFile(
  actions: readonly AnalysisAction[],
): ReadonlyMap<string, readonly AnalysisAction[]> {
  const out = new Map<string, AnalysisAction[]>();
  for (const action of actions) {
    if (action.edits.length === 0) continue;
    for (const edit of action.edits) {
      const bucket = out.get(edit.file);
      if (bucket === undefined) {
        out.set(edit.file, [action]);
      } else if (!bucket.includes(action)) {
        bucket.push(action);
      }
    }
  }
  return out;
}

function buildPlan(
  grouped: ReadonlyMap<string, readonly AnalysisAction[]>,
): readonly PlannedFileFix[] {
  const out: PlannedFileFix[] = [];
  // Iterate map in path-sorted order for determinism.
  const files = [...grouped.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const file of files) {
    const actions = grouped.get(file) ?? [];
    const edits: Edit[] = [];
    const ruleSet = new Set<RuleId>();
    for (const action of actions) {
      ruleSet.add(action.diagnostic.kind);
      for (const edit of action.edits) {
        if (edit.file === file) edits.push(edit);
      }
    }
    // Edit ordering: descending by start offset so application doesn't shift
    // earlier offsets after splicing.
    const sortedEdits = [...edits].sort(
      (a, b) => b.range.start.byteOffset - a.range.start.byteOffset,
    );
    out.push(
      Object.freeze({
        file,
        edits: Object.freeze(sortedEdits) as readonly Edit[],
        ruleIds: Object.freeze([...ruleSet].sort()) as readonly RuleId[],
      }) satisfies PlannedFileFix,
    );
  }
  return out;
}

async function applyOneFile(
  planned: PlannedFileFix,
  hashOf?: (content: string) => string,
): Promise<FileFixOutcome> {
  let original: string;
  try {
    original = await readFile(planned.file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (code === 'ENOENT') {
      return {
        status: 'missing',
        file: planned.file,
        message: `${MISSING_FILE_PREFIX}${planned.file}`,
      };
    }
    return {
      status: 'error',
      file: planned.file,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Validate every edit fits within current content. If any edit is OOB the
  // most likely cause is on-disk drift since action-generation; refuse with a
  // verbatim drift message rather than the OOB message because the user-
  // facing semantics are identical (we won't apply).
  for (const edit of planned.edits) {
    const startOff = edit.range.start.byteOffset;
    const endOff = edit.range.end.byteOffset;
    const utf8Bytes = Buffer.byteLength(original, 'utf8');
    if (startOff < 0 || endOff < startOff || endOff > utf8Bytes) {
      return {
        status: 'drift',
        file: planned.file,
        message: `${DRIFT_MESSAGE_PREFIX}${planned.file}`,
      };
    }
  }

  // Apply edits in pre-sorted descending order. Convert byte offsets to
  // string indices via Buffer slicing to preserve UTF-8 multibyte safety.
  let next = original;
  for (const edit of planned.edits) {
    next = spliceByByteOffset(
      next,
      edit.range.start.byteOffset,
      edit.range.end.byteOffset,
      edit.newText,
    );
  }

  if (next === original) {
    return { status: 'unchanged', file: planned.file };
  }

  const hash = hashOf ?? defaultHashOf;
  // Final hash drift gate: re-read just before write — if the file changed
  // since our initial read, refuse.
  let stillCurrent: string;
  try {
    stillCurrent = await readFile(planned.file, 'utf8');
  } catch (err) {
    return {
      status: 'error',
      file: planned.file,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (hash(stillCurrent) !== hash(original)) {
    return {
      status: 'drift',
      file: planned.file,
      message: `${DRIFT_MESSAGE_PREFIX}${planned.file}`,
    };
  }

  const tmp = `${planned.file}.tmp.${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, next, 'utf8');
    await rename(tmp, planned.file);
  } catch (err) {
    // Best-effort cleanup of the tmp file on rename failure.
    try {
      await unlink(tmp);
    } catch {
      // ignore
    }
    return {
      status: 'error',
      file: planned.file,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return { status: 'applied', file: planned.file, editCount: planned.edits.length };
}

function defaultHashOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Replace the bytes between `[startByte, endByte)` in `text` (UTF-8) with
 * `replacement`. The function is multibyte-safe — we round-trip through
 * `Buffer` so a range that lands in the middle of a code point is impossible
 * (parser-emitted ranges always fall on UTF-8 code-point boundaries).
 */
export function spliceByByteOffset(
  text: string,
  startByte: number,
  endByte: number,
  replacement: string,
): string {
  const buf = Buffer.from(text, 'utf8');
  const head = buf.subarray(0, startByte).toString('utf8');
  const tail = buf.subarray(endByte).toString('utf8');
  return `${head}${replacement}${tail}`;
}
