import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { ParseErrorCode } from './codes.js';

export interface FugaziParseErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: ParseErrorCode;
}

export class FugaziParseError extends FugaziError {
  declare readonly code: ParseErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziParseErrorArgs
  constructor(args: FugaziParseErrorArgs) {
    super(args);
  }
}
