/**
 * dupes/index.ts — Phase 3f.4 Wave A + Wave B.
 *
 * Internal barrel for the duplicate-detection engine. Wave A landed Type-1
 * (exact-match) clones; Wave B layers Type-2/3/4 normalization passes and the
 * unified `findAllClones` dispatcher with subsumption.
 *
 * `code-duplication` rule (rules/code-duplication.ts) imports from here.
 */

export { tokenize, type Token, type TokenStream } from './tokenize.js';
export { buildSuffixArray, computeLCP, type SuffixArrayResult } from './suffix-array.js';
export { findType1Clones, type CloneFamily, type CloneOccurrence } from './type1.js';
export { normalizeForType2, normalizeForType3, normalizeForType4 } from './normalize.js';
export {
  findType2Clones,
  findType3Clones,
  findType4Clones,
  type FindType3Options,
} from './type234.js';
export { findAllClones, type FindAllClonesOptions } from './find-clones.js';
