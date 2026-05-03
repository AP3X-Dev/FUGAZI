import { db } from '../db/client';
export function handler(): unknown {
  return db();
}
