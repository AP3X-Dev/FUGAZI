/**
 * Position — a single point in a source file.
 *
 *   - line:        1-based line number.
 *   - column:      0-based UTF-16 code-unit column (matches LSP semantics).
 *   - byteOffset:  0-based UTF-8 byte offset from start of file (matches the
 *                  V8 ScriptCoverage byte-offset domain in @fugazi/v8-coverage,
 *                  enabling deterministic mapping between source ranges and
 *                  coverage hits).
 *
 * All fields are readonly: a Position is immutable post-construction. Per
 * NFR-1 (determinism) we never mutate Position objects in hot paths.
 */
export interface Position {
  readonly line: number;
  readonly column: number;
  readonly byteOffset: number;
}

/**
 * Range — a half-open span [start, end) in a source file.
 *
 * Both ends are Position values; deeply readonly, never mutated after
 * construction. Per FR-D3 (Map / Set insertion-order discipline) and SC-15
 * (output format determinism), reporters serialize ranges by emitting start
 * before end and never reordering nested fields.
 */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}
