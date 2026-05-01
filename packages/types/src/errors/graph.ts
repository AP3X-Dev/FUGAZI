import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { GraphErrorCode } from './codes.js';

export interface FugaziGraphErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: GraphErrorCode;
}

export class FugaziGraphError extends FugaziError {
  declare readonly code: GraphErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziGraphErrorArgs
  constructor(args: FugaziGraphErrorArgs) {
    super(args);
  }
}
