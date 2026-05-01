import type { ErrorCode } from './codes.js';

export interface FugaziErrorArgs {
  readonly code: ErrorCode;
  readonly message: string;
  readonly help?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly cause?: Error;
}

/**
 * FugaziError — the base class for every typed Fugazi error.
 *
 * Subclasses (one per package) narrow the `code` field at the type level via
 * `declare readonly code: <SubCode>` while inheriting the runtime constructor.
 *
 * Field handling:
 *   - `code` is always assigned in the constructor (always present).
 *   - `help` and `context` are conditionally assigned. They are NOT declared
 *     as class fields (with `useDefineForClassFields: true`, declared fields
 *     are auto-initialized to `undefined`, which makes `'help' in err === true`
 *     even when omitted — incompatible with `exactOptionalPropertyTypes: true`).
 *     Instead they are typed via a `declare` block, which only adds type info.
 */
export class FugaziError extends Error {
  declare readonly code: ErrorCode;
  declare readonly help?: string;
  declare readonly context?: Readonly<Record<string, unknown>>;

  constructor(args: FugaziErrorArgs) {
    super(args.message, args.cause ? { cause: args.cause } : undefined);
    this.name = new.target.name;
    Object.defineProperty(this, 'code', {
      value: args.code,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    if (args.help !== undefined) {
      Object.defineProperty(this, 'help', {
        value: args.help,
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
    if (args.context !== undefined) {
      Object.defineProperty(this, 'context', {
        value: args.context,
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
  }
}
