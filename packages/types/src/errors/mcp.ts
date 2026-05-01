import { FugaziError, type FugaziErrorArgs } from './base.js';
import type { McpErrorCode } from './codes.js';

export interface FugaziMcpErrorArgs extends Omit<FugaziErrorArgs, 'code'> {
  readonly code: McpErrorCode;
}

export class FugaziMcpError extends FugaziError {
  declare readonly code: McpErrorCode;

  // biome-ignore lint/complexity/noUselessConstructor: narrows args type to FugaziMcpErrorArgs
  constructor(args: FugaziMcpErrorArgs) {
    super(args);
  }
}
