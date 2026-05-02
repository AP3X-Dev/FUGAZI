import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { CoverageErrorCode } from './codes.js';

export interface FugaziCoverageErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: CoverageErrorCode;
}

export class FugaziCoverageError extends FugaziError {
  declare readonly code: CoverageErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziCoverageErrorArgs
  constructor(args: FugaziCoverageErrorArgs) {
    super(args);
  }
}
