/**
 * istanbul.ts — Phase 3e (T116-T117) — V8 → Istanbul normalizer.
 *
 * Converts a V8 ScriptCoverage entry into the Istanbul `FileCoverage` shape
 * (subset) consumed by downstream Fugazi runtime-intelligence components.
 *
 * Mapping:
 *   - For every V8 function, the OUTERMOST range becomes the function's `loc`
 *     and the function's hit count (= outermost range count). The
 *     declaration position `decl` is the start of the loc (V8 doesn't emit a
 *     separate decl).
 *   - Functions with `isBlockCoverage: true` contribute their inner ranges
 *     to `branchMap` + `b` and `statementMap` + `s`. Each branch entry lists
 *     all sub-ranges as alternative locations; `b[idx][i]` is the hit count
 *     of the i-th alternative. Statements are the same sub-ranges as flat
 *     entries with their counts.
 *   - Functions with `isBlockCoverage: false` contribute the outer range as a
 *     single statement entry — branchMap/b stay empty.
 *   - Empty `script.functions` produces a valid empty Istanbul object (no
 *     throw).
 *
 * Determinism (NFR-1 / SC-15): output keys are stringified integers in
 * declaration order, no `Date.now`, no random.
 */

import { type OffsetMap, buildOffsetMap } from './offset-map.js';
import type { CoverageRange, ScriptCoverage } from './types.js';

export interface IstanbulRange {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

export interface IstanbulFnDef {
  readonly name: string;
  readonly decl: IstanbulRange;
  readonly loc: IstanbulRange;
  readonly line: number;
}

export interface IstanbulBranchDef {
  readonly type: 'branch';
  readonly loc: IstanbulRange;
  readonly locations: readonly IstanbulRange[];
}

export interface IstanbulFileCoverage {
  readonly path: string;
  readonly statementMap: Readonly<Record<string, IstanbulRange>>;
  readonly s: Readonly<Record<string, number>>;
  readonly fnMap: Readonly<Record<string, IstanbulFnDef>>;
  readonly f: Readonly<Record<string, number>>;
  readonly branchMap: Readonly<Record<string, IstanbulBranchDef>>;
  readonly b: Readonly<Record<string, readonly number[]>>;
}

function rangeFor(map: OffsetMap, r: CoverageRange): IstanbulRange {
  const start = map.toPosition(r.startOffset);
  const end = map.toPosition(r.endOffset);
  return {
    start: { line: start.line, column: start.col },
    end: { line: end.line, column: end.col },
  };
}

export function normalizeToIstanbul(script: ScriptCoverage, source: string): IstanbulFileCoverage {
  const map = buildOffsetMap(source);
  const fnMap: Record<string, IstanbulFnDef> = {};
  const f: Record<string, number> = {};
  const statementMap: Record<string, IstanbulRange> = {};
  const s: Record<string, number> = {};
  const branchMap: Record<string, IstanbulBranchDef> = {};
  const b: Record<string, number[]> = {};

  let stmtIdx = 0;
  let branchIdx = 0;

  for (let fi = 0; fi < script.functions.length; fi++) {
    const fn = script.functions[fi];
    if (fn === undefined) continue;
    const fnKey = String(fi);
    const outer = fn.ranges[0];
    if (outer === undefined) {
      // No ranges: emit a degenerate but valid entry at line 1 col 0.
      const zero: IstanbulRange = {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 0 },
      };
      fnMap[fnKey] = {
        name: fn.functionName.length > 0 ? fn.functionName : '(anonymous)',
        decl: zero,
        loc: zero,
        line: 1,
      };
      f[fnKey] = 0;
      continue;
    }
    const outerLoc = rangeFor(map, outer);
    fnMap[fnKey] = {
      name: fn.functionName.length > 0 ? fn.functionName : '(anonymous)',
      decl: { start: outerLoc.start, end: outerLoc.start },
      loc: outerLoc,
      line: outerLoc.start.line,
    };
    f[fnKey] = outer.count;

    if (fn.isBlockCoverage && fn.ranges.length > 1) {
      // Inner ranges (excluding outer) become both branches and statements.
      const inner = fn.ranges.slice(1);
      const locations: IstanbulRange[] = [];
      const counts: number[] = [];
      for (const r of inner) {
        const irange = rangeFor(map, r);
        locations.push(irange);
        counts.push(r.count);
        // Each inner range is also a statement.
        const sKey = String(stmtIdx);
        statementMap[sKey] = irange;
        s[sKey] = r.count;
        stmtIdx++;
      }
      const bKey = String(branchIdx);
      branchMap[bKey] = {
        type: 'branch',
        loc: outerLoc,
        locations,
      };
      b[bKey] = counts;
      branchIdx++;
    } else {
      // Non-block coverage: emit the outer range as a single statement.
      const sKey = String(stmtIdx);
      statementMap[sKey] = outerLoc;
      s[sKey] = outer.count;
      stmtIdx++;
    }
  }

  return {
    path: script.url,
    statementMap,
    s,
    fnMap,
    f,
    branchMap,
    b,
  };
}
