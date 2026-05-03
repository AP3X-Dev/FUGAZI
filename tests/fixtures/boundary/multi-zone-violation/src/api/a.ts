import { infraThing } from '../infra/x';
import { dbThing } from '../db/y';
export function fan(): string {
  return infraThing() + dbThing();
}
