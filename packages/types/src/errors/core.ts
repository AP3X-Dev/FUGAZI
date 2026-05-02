import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { CoreErrorCode } from './codes.js';

export interface FugaziCoreErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: CoreErrorCode;
}

/**
 * `FugaziCoreError` — typed error thrown by the @fugazi/core analysis driver.
 *
 *   - `CORE_ABORTED`         — `runAnalysis()` was cancelled via `AbortSignal`
 *                              before completion. The verbatim message is
 *                              `runAnalysis aborted at phase: <phase>`.
 *   - `CORE_INVALID_OPTIONS` — `RunAnalysisOptions` failed pre-flight validation
 *                              (e.g. non-absolute `projectRoot`, null `config`).
 */
export class FugaziCoreError extends FugaziError {
  declare readonly code: CoreErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziCoreErrorArgs
  constructor(args: FugaziCoreErrorArgs) {
    super(args);
  }
}
