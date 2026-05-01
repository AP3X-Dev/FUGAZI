import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { CacheErrorCode } from './codes.js';

export interface FugaziCacheErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: CacheErrorCode;
}

export class FugaziCacheError extends FugaziError {
  declare readonly code: CacheErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziCacheErrorArgs
  constructor(args: FugaziCacheErrorArgs) {
    super(args);
  }
}
