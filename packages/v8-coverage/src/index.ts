/**
 * @fugazi/v8-coverage — Phase 3e (T108-T118) — V8 ScriptCoverage parser +
 * Istanbul normalizer. Public surface composed from the per-feature modules.
 */

export type {
  CoverageInput,
  CoverageRange,
  FunctionCoverage,
  ScriptCoverage,
} from './types.js';
export { parseCoverage, parseCoverageFile, type ParseCoverageOptions } from './parse.js';
export { buildOffsetMap, type OffsetMap, type Position } from './offset-map.js';
export { disambiguateScripts } from './script-id.js';
export {
  rebaseCoverage,
  type RebaseOptions,
  type RebasedScript,
} from './rebase.js';
export {
  normalizeToIstanbul,
  type IstanbulBranchDef,
  type IstanbulFileCoverage,
  type IstanbulFnDef,
  type IstanbulRange,
} from './istanbul.js';
