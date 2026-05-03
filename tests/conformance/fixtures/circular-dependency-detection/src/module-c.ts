import { fromA } from './module-a';

export function fromC(): string {
  // Closes the cycle a -> b -> c -> a.
  return fromA.name;
}
