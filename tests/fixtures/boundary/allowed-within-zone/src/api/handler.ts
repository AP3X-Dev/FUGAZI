import { fetchUser } from './service';
export function handler(): string {
  return fetchUser();
}
