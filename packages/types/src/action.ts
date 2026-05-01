import type { Range } from './position.js';

/**
 * Action — a discriminated union of safe, machine-applicable code mutations
 * that Fugazi can suggest as fixes for an Issue.
 *
 * Every variant is `readonly`-deep and discriminated by `kind`. The 6 variants
 * cover the closed set of fix shapes the v1 fix engine (Phase 3h) executes:
 *
 *   - remove-export        — strip an `export` clause for a specific name.
 *   - remove-import        — strip a named import from an import declaration.
 *   - remove-file          — delete an unreferenced source file outright.
 *   - rewrite-line         — replace one source line with new content.
 *   - remove-enum-member   — remove a single member from an enum declaration.
 *   - remove-class-member  — remove a single member from a class declaration.
 *
 * Adding a new fix shape requires extending this union and the corresponding
 * Phase 3h applier; consumers must exhaustively switch on `kind`.
 */
export type Action =
  | {
      readonly kind: 'remove-export';
      readonly file: string;
      readonly range: Range;
      readonly exportName: string;
    }
  | {
      readonly kind: 'remove-import';
      readonly file: string;
      readonly range: Range;
      readonly importedName: string;
    }
  | {
      readonly kind: 'remove-file';
      readonly file: string;
    }
  | {
      readonly kind: 'rewrite-line';
      readonly file: string;
      readonly line: number;
      readonly newContent: string;
    }
  | {
      readonly kind: 'remove-enum-member';
      readonly file: string;
      readonly range: Range;
      readonly memberName: string;
    }
  | {
      readonly kind: 'remove-class-member';
      readonly file: string;
      readonly range: Range;
      readonly memberName: string;
    };
