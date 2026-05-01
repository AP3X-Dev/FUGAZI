import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { LspErrorCode } from './codes.js';

export interface FugaziLspErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: LspErrorCode;
}

export class FugaziLspError extends FugaziError {
  declare readonly code: LspErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziLspErrorArgs
  constructor(args: FugaziLspErrorArgs) {
    super(args);
  }
}
