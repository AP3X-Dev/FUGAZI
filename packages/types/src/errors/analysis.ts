import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { AnalysisErrorCode } from './codes.js';

export interface FugaziAnalysisErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: AnalysisErrorCode;
}

export class FugaziAnalysisError extends FugaziError {
  declare readonly code: AnalysisErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziAnalysisErrorArgs
  constructor(args: FugaziAnalysisErrorArgs) {
    super(args);
  }
}
