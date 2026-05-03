/**
 * rules/code-duplication.ts — Phase 3f.4 Wave B.
 *
 * Wraps the `findAllClones` dispatcher (packages/core/src/dupes) into a rule
 * handler. Reads each FileNode's source from disk, tokenizes it, runs the
 * dispatcher, and emits one `CodeDuplicationIssue` per `CloneFamily`.
 *
 * Behaviour:
 *
 *   - File reads are fail-soft: a file we can't read is silently skipped, so
 *     a single hostile path does not abort the rule (per RuleHandler contract).
 *   - Each issue's `range` is the FIRST occurrence's byte range converted to a
 *     `Range` (line/column derived from the source string the file produced).
 *   - The `file` field is the first occurrence's file path. Path-sorted
 *     occurrences inside `findAllClones` keep this deterministic.
 *   - Verbatim message format:
 *       `code-duplication: type-<N> clone of <M> tokens in <K> places`
 *     This string is fixture-asserted; do not edit without updating the test.
 */

import { readFileSync } from 'node:fs';
import type { CodeDuplicationIssue, DiscriminatedIssue, Range, Severity } from '@fugazi/types';
import {
  type CloneFamily,
  type FindAllClonesOptions,
  findAllClones,
  tokenize,
  tokenizePython,
} from '../dupes/index.js';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'code-duplication' as const;

/**
 * Build the `code-duplication` rule with the resolved severity threaded
 * through. Reads `config.dupes?.minTokens` from the FugaziConfig if present
 * (the schema does not currently model `dupes`, so we read defensively via
 * `Record<string, unknown>` access).
 */
export function createCodeDuplicationRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const opts: FindAllClonesOptions = readDupesOptions(ctx.config);

    // Read sources, tokenize, build streams. Failures are silently skipped.
    const streams: ReturnType<typeof tokenize>[] = [];
    const sourceByFile = new Map<string, string>();
    const sortedNodes = [...ctx.graph.files.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    for (const node of sortedNodes) {
      let src: string;
      try {
        src = readFileSync(node.path, 'utf8');
      } catch {
        continue;
      }
      sourceByFile.set(node.path, src);
      // Phase 4c T336: dispatch by file extension. `.py` files use the
      // Python tokenizer; everything else falls through to the TS/JS one.
      const stream = node.path.endsWith('.py')
        ? tokenizePython(node.path, src)
        : tokenize(node.path, src);
      streams.push(stream);
    }
    if (streams.length === 0) return [];

    const families = findAllClones(streams, opts);
    if (families.length === 0) return [];

    const out: CodeDuplicationIssue[] = [];
    for (const family of families) {
      const first = family.occurrences[0];
      if (first === undefined) continue;
      const firstSrc = sourceByFile.get(first.file);
      if (firstSrc === undefined) continue;

      const occurrences: { readonly file: string; readonly range: Range }[] = [];
      for (const occ of family.occurrences) {
        const src = sourceByFile.get(occ.file);
        if (src === undefined) continue;
        const range = byteRangeToRange(src, occ.byteRange.start, occ.byteRange.end);
        occurrences.push(Object.freeze({ file: occ.file, range }));
      }
      if (occurrences.length < 2) continue;

      const primaryRange = byteRangeToRange(firstSrc, first.byteRange.start, first.byteRange.end);

      const issue: CodeDuplicationIssue = Object.freeze({
        kind: RULE_KIND,
        severity,
        file: first.file,
        range: primaryRange,
        cloneType: cloneTypeOf(family),
        occurrences: Object.freeze(occurrences),
        message: `code-duplication: type-${cloneTypeOf(family)} clone of ${family.tokenLength} tokens in ${family.occurrences.length} places`,
      });
      out.push(issue);
    }

    out.sort((a, b) => {
      if (a.file < b.file) return -1;
      if (a.file > b.file) return 1;
      const ao = a.range?.start.byteOffset ?? -1;
      const bo = b.range?.start.byteOffset ?? -1;
      if (ao !== bo) return ao - bo;
      return 0;
    });

    return out as readonly DiscriminatedIssue[];
  };
}

/** Read `dupes` options from config defensively (the schema does not yet model it). */
function readDupesOptions(config: unknown): FindAllClonesOptions {
  if (typeof config !== 'object' || config === null) return {};
  const dupes = (config as { readonly dupes?: unknown }).dupes;
  if (typeof dupes !== 'object' || dupes === null) return {};
  const out: { -readonly [K in keyof FindAllClonesOptions]: FindAllClonesOptions[K] } = {};
  const minTokens = (dupes as { readonly minTokens?: unknown }).minTokens;
  if (typeof minTokens === 'number' && minTokens > 0) {
    out.minTokens = minTokens;
  }
  return out;
}

function cloneTypeOf(family: CloneFamily): 1 | 2 | 3 | 4 {
  switch (family.kind) {
    case 'type-1':
      return 1;
    case 'type-2':
      return 2;
    case 'type-3':
      return 3;
    case 'type-4':
      return 4;
  }
}

/**
 * Convert a half-open byte range `[start, end)` into a fully-typed `Range`.
 * Lines are 1-based; columns are 0-based UTF-16 code-unit offsets (matches
 * `Position` semantics in `@fugazi/types`).
 */
function byteRangeToRange(source: string, start: number, end: number): Range {
  return {
    start: byteOffsetToPosition(source, start),
    end: byteOffsetToPosition(source, end),
  };
}

function byteOffsetToPosition(
  source: string,
  byteOffset: number,
): { readonly line: number; readonly column: number; readonly byteOffset: number } {
  // Walk the source counting newlines up to `byteOffset`. Source is treated as
  // UTF-16 code units; tokenize.ts records `byteOffset` in the same units, so
  // this is consistent end-to-end inside the rule.
  let line = 1;
  let lineStart = 0;
  const len = Math.min(byteOffset, source.length);
  for (let i = 0; i < len; i++) {
    if (source.charCodeAt(i) === 0x0a) {
      line++;
      lineStart = i + 1;
    }
  }
  return {
    line,
    column: byteOffset - lineStart,
    byteOffset,
  };
}
