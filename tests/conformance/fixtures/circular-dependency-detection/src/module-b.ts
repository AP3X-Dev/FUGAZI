import { fromC } from './module-c';

export function fromB(): string {
  return `b-${fromC()}`;
}
