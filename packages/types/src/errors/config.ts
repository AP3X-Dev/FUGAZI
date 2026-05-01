import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { ConfigErrorCode } from './codes.js';

export interface FugaziConfigErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: ConfigErrorCode;
}

export class FugaziConfigError extends FugaziError {
  declare readonly code: ConfigErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziConfigErrorArgs
  constructor(args: FugaziConfigErrorArgs) {
    super(args);
  }
}
