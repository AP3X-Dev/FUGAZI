import { addNumbers, formatDate } from './utils/index';

export function summary(): string {
  return `${formatDate(new Date(0))}:${addNumbers(1, 2)}`;
}
