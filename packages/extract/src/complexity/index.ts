/**
 * complexity/index.ts — Phase 3c.7 (T078) — file-level complexity orchestrator.
 *
 * Walks every `FunctionDecl` reachable from the program root via the shared
 * `walk()` helper and emits a `FunctionComplexity` per function plus a
 * file-level aggregate (`FileComplexity`). For each function we compute:
 *
 *   - cyclomatic           — McCabe cyclomatic complexity (`./cyclomatic.js`)
 *   - cognitive            — Sonar cognitive complexity (`./cognitive.js`)
 *   - maintainabilityIndex — normalised MI in [0, 100] (`./mi.js`)
 *   - loc                  — non-blank lines within the function range
 *
 * Function naming:
 *
 *   - For top-level `FunctionDecl` we use `node.name` directly. Anonymous
 *     export-default functions arrive with `name === null`; those collapse to
 *     the synthetic name `'<anonymous>'`.
 *   - For class methods we emit one `FunctionComplexity` per `ClassDecl.members`
 *     entry with the qualified name `<class>.<member>`. The current parser
 *     adapter does NOT expose method bodies as walkable `FunctionDecl` nodes
 *     (`ClassDecl.body` is empty by construction in `parsers/oxc.ts`), so the
 *     emitted entry carries cyclomatic = 1, cognitive = 0, MI computed against
 *     the class's own range.
 *
 * Known limitations (documented):
 *
 *   - Anonymous arrow functions assigned to a `VariableDecl` initializer
 *     (`const f = () => ...`) are not visited because the walker does not
 *     descend into declarator initializers (see `ast/visit.js`). Closing this
 *     requires a future visitor extension.
 *   - Nested `FunctionDecl` inside an outer function's body are reached by the
 *     walker; their decisions ALSO add to the outer function's source-scan
 *     cyclomatic count, since the scanner sees the inner body's keywords. This
 *     is a known accuracy gap — a stricter implementation would mask inner
 *     function bodies during the outer scan.
 *   - Halstead Volume is approximated (see `./mi.js`) — not the full classical
 *     formulation. Sufficient for cross-function comparison.
 *
 * Determinism (NFR-1 / SC-15): output is sorted by `range.start.byteOffset`,
 * then by `name`, and the returned object is deeply frozen. Two consecutive
 * `computeComplexity` calls on the same `Program` produce byte-equal
 * `JSON.stringify(result)`.
 */

import type { Range } from '@fugazi/types';
import type { AsyncFunctionDef, FunctionDef, PyProgram } from '../ast/kinds-py.js';
import type { FunctionDecl, Program } from '../ast/kinds.js';
import { walkPy } from '../ast/visit-py.js';
import { walk } from '../ast/visit.js';
import { computeCognitivePy } from './cognitive-py.js';
import { computeCognitive } from './cognitive.js';
import { computeCyclomaticPy } from './cyclomatic-py.js';
import { computeCyclomatic } from './cyclomatic.js';
import { approximateHalsteadVolume, computeMi, countNonBlankLines } from './mi.js';

export interface FunctionComplexity {
  readonly name: string;
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly maintainabilityIndex: number;
  readonly loc: number;
  readonly range: Range;
}

export interface FileComplexityAggregate {
  /** Sum of per-function cyclomatic complexities. */
  readonly cyclomatic: number;
  /** Sum of per-function cognitive complexities. */
  readonly cognitive: number;
  /** Mean of per-function maintainability indices, or 100 when no functions. */
  readonly maintainabilityIndex: number;
  /** Sum of per-function LOC (non-blank lines within each function range). */
  readonly loc: number;
}

export interface FileComplexity {
  readonly functions: readonly FunctionComplexity[];
  readonly aggregate: FileComplexityAggregate;
  /** Set when `MAX_FUNCTIONS_PER_FILE` was exceeded; absent otherwise. */
  readonly truncated?: true;
}

/**
 * Hard cap on per-file function count. A file with more than this many
 * functions short-circuits — any FunctionComplexity emitted past the cap is
 * dropped and the result carries `truncated: true`. The cap exists to prevent
 * pathological generated source from blowing up reporter output.
 */
export const MAX_FUNCTIONS_PER_FILE = 1000;

const ANONYMOUS_NAME = '<anonymous>';

/**
 * Compute file-level complexity for a parsed `Program` plus its source text.
 * Walks every reachable `FunctionDecl` and `ClassDecl`, sorts the resulting
 * `FunctionComplexity` array by source position, and returns a frozen object.
 */
export function computeComplexity(program: Program, source: string): FileComplexity {
  const collected: FunctionComplexity[] = [];
  let truncated = false;
  walk(program, {
    onEnter: (node) => {
      if (truncated) return;
      if (node.kind === 'FunctionDecl') {
        if (collected.length >= MAX_FUNCTIONS_PER_FILE) {
          truncated = true;
          return;
        }
        collected.push(emitFunction(node, source));
        return;
      }
      if (node.kind === 'ClassDecl') {
        for (const m of node.members) {
          if (collected.length >= MAX_FUNCTIONS_PER_FILE) {
            truncated = true;
            return;
          }
          if (m.name === '') continue;
          const qualified =
            node.name !== null && node.name !== '' ? `${node.name}.${m.name}` : m.name;
          collected.push(emitMethodPlaceholder(qualified, m.range, source));
        }
      }
    },
  });

  const sorted = collected
    .slice()
    .sort((a, b) => {
      const offsetDelta = a.range.start.byteOffset - b.range.start.byteOffset;
      if (offsetDelta !== 0) return offsetDelta;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    })
    .map((f) => Object.freeze(f));

  const aggregate = computeAggregate(sorted);
  const base: FileComplexity = {
    functions: Object.freeze(sorted),
    aggregate: Object.freeze(aggregate),
  };
  return Object.freeze(truncated ? { ...base, truncated: true } : base) satisfies FileComplexity;
}

function emitFunction(node: FunctionDecl, source: string): FunctionComplexity {
  const name = node.name === null || node.name === '' ? ANONYMOUS_NAME : node.name;
  const cyclomatic = computeCyclomatic(node, source);
  const cognitive = computeCognitive(node, source);
  const slice = source.slice(
    Math.max(0, node.range.start.byteOffset),
    Math.min(source.length, node.range.end.byteOffset),
  );
  const loc = countNonBlankLines(source, node.range.start.line, node.range.end.line);
  const rawVolume = approximateHalsteadVolume(slice);
  const volume = rawVolume > 0 ? rawVolume : Math.max(1, loc * 4);
  const maintainabilityIndex = computeMi(volume, cyclomatic, loc);
  return {
    name,
    cyclomatic,
    cognitive,
    maintainabilityIndex,
    loc,
    range: node.range,
  };
}

function emitMethodPlaceholder(
  qualifiedName: string,
  memberRange: Range,
  source: string,
): FunctionComplexity {
  // Class members surface only as bare identifier nodes — the parser does not
  // expose their bodies. We emit a baseline-complexity entry so downstream
  // reporters can still show the qualified name in tree views.
  const loc = countNonBlankLines(source, memberRange.start.line, memberRange.end.line);
  const fallbackVolume = Math.max(1, loc * 4);
  return {
    name: qualifiedName,
    cyclomatic: 1,
    cognitive: 0,
    maintainabilityIndex: computeMi(fallbackVolume, 1, Math.max(1, loc)),
    loc,
    range: memberRange,
  };
}

function computeAggregate(fns: readonly FunctionComplexity[]): FileComplexityAggregate {
  if (fns.length === 0) {
    return {
      cyclomatic: 0,
      cognitive: 0,
      maintainabilityIndex: 100,
      loc: 0,
    };
  }
  let cycSum = 0;
  let cogSum = 0;
  let miSum = 0;
  let locSum = 0;
  for (const f of fns) {
    cycSum += f.cyclomatic;
    cogSum += f.cognitive;
    miSum += f.maintainabilityIndex;
    locSum += f.loc;
  }
  const miMean = Number((miSum / fns.length).toFixed(6));
  return {
    cyclomatic: cycSum,
    cognitive: cogSum,
    maintainabilityIndex: miMean,
    loc: locSum,
  };
}

/**
 * Compute file-level complexity for a parsed `PyProgram` plus its source text.
 * Walks every reachable `FunctionDef` / `AsyncFunctionDef` (including
 * class-method bodies) and emits one `FunctionComplexity` per function.
 *
 * Class methods are surfaced with the qualified name `<class>.<method>` so
 * downstream reporters can show them under their parent in tree views,
 * matching the TS variant's behaviour. Unlike TS (where the parser does not
 * expose class-method bodies), tree-sitter-python DOES expose method bodies
 * as walkable `FunctionDef` nodes, so cyclomatic + cognitive scores reflect
 * the real method contents.
 *
 * Determinism (NFR-1 / SC-15): output sorted by `range.start.byteOffset`,
 * then by `name`; deeply frozen.
 */
export function computeComplexityPy(program: PyProgram, source: string): FileComplexity {
  const collected: FunctionComplexity[] = [];
  let truncated = false;
  const classStack: string[] = [];

  walkPy(program, {
    onEnter: (node) => {
      if (truncated) return;
      if (node.kind === 'ClassDef') {
        classStack.push(node.name);
        return;
      }
      if (node.kind === 'FunctionDef' || node.kind === 'AsyncFunctionDef') {
        if (collected.length >= MAX_FUNCTIONS_PER_FILE) {
          truncated = true;
          return;
        }
        const baseName = node.name === '' ? ANONYMOUS_NAME : node.name;
        const qualified =
          classStack.length > 0 ? `${classStack[classStack.length - 1]}.${baseName}` : baseName;
        collected.push(emitFunctionPy(node, qualified, source));
      }
    },
    onLeave: (node) => {
      if (node.kind === 'ClassDef') {
        classStack.pop();
      }
    },
  });

  const sorted = collected
    .slice()
    .sort((a, b) => {
      const offsetDelta = a.range.start.byteOffset - b.range.start.byteOffset;
      if (offsetDelta !== 0) return offsetDelta;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    })
    .map((f) => Object.freeze(f));

  const aggregate = computeAggregate(sorted);
  const base: FileComplexity = {
    functions: Object.freeze(sorted),
    aggregate: Object.freeze(aggregate),
  };
  return Object.freeze(truncated ? { ...base, truncated: true } : base) satisfies FileComplexity;
}

function emitFunctionPy(
  node: FunctionDef | AsyncFunctionDef,
  qualifiedName: string,
  source: string,
): FunctionComplexity {
  const cyclomatic = computeCyclomaticPy(node, source);
  const cognitive = computeCognitivePy(node, source);
  const slice = source.slice(
    Math.max(0, node.range.start.byteOffset),
    Math.min(source.length, node.range.end.byteOffset),
  );
  const loc = countNonBlankLines(source, node.range.start.line, node.range.end.line);
  const rawVolume = approximateHalsteadVolume(slice);
  const volume = rawVolume > 0 ? rawVolume : Math.max(1, loc * 4);
  const maintainabilityIndex = computeMi(volume, cyclomatic, loc);
  return {
    name: qualifiedName,
    cyclomatic,
    cognitive,
    maintainabilityIndex,
    loc,
    range: node.range,
  };
}

// Re-exports so callers can pull the per-metric helpers from a single import.
export { computeCognitive } from './cognitive.js';
export { computeCyclomatic } from './cyclomatic.js';
export { computeCognitivePy } from './cognitive-py.js';
export { computeCyclomaticPy } from './cyclomatic-py.js';
export { computeMi } from './mi.js';
