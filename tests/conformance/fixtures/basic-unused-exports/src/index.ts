import { usedHelper } from './helpers';
import type { UsedConfig } from './config';

export function entry(cfg: UsedConfig): string {
  return usedHelper(cfg.label);
}
