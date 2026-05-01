/**
 * types.ts — Phase 3c.4 Dispatch B (T063) — visitor inventory shape.
 *
 * Public types produced by `buildInventory(program)`. Three flat collections
 * (declarations, imports, usages) sorted by `range.start.byteOffset` (then by
 * name) so byte-equal JSON serialisation is guaranteed across runs (NFR-1).
 *
 * Per IMP-DEBT-08: every collection is an `Array` (insertion-ordered, no
 * `Map` / `Set`) and every property is `readonly`. The visitor never reaches
 * for the original Fallow Rust pipeline's string-sentinel pattern.
 */

import type { Range } from '@fugazi/types';

export type DeclarationKind = 'function' | 'class' | 'variable' | 'type' | 'enum';

export interface Declaration {
  readonly kind: DeclarationKind;
  readonly name: string;
  readonly exported: boolean;
  readonly range: Range;
  readonly members: readonly string[];
}

export type ImportKind = 'static' | 'dynamic' | 'reexport' | 'asset' | 'type';

export interface Import {
  readonly kind: ImportKind;
  readonly source: string;
  readonly resolvable: boolean;
  readonly range: Range;
}

export type UsageKind = 'identifier' | 'jsx' | 'member' | 'decorator';

export interface Usage {
  readonly kind: UsageKind;
  readonly name: string;
  readonly range: Range;
}

export interface Inventory {
  readonly declarations: readonly Declaration[];
  readonly imports: readonly Import[];
  readonly usages: readonly Usage[];
}
