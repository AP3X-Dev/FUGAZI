import type { UsedShape } from './types';
import { makeShape } from './factory';

export function pipeline(): UsedShape {
  return makeShape();
}
