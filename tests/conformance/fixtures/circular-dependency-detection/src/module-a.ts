import { fromB } from './module-b';

export function fromA(): string {
  return `a-${fromB()}`;
}
