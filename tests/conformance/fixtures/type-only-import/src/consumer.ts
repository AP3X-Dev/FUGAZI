// Orphan consumer — no other file imports this; demonstrates that even a
// file that itself imports types is still considered an unused-file when
// nothing imports IT in turn.
import type { UsedShape } from './types';

export function describe(s: UsedShape): string {
  return `${s.id}:${s.label}`;
}
