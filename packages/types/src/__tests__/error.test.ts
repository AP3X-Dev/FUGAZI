import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  FugaziAnalysisError,
  FugaziCacheError,
  FugaziConfigError,
  FugaziError,
  type FugaziErrorArgs,
  FugaziGraphError,
  FugaziLspError,
  FugaziMcpError,
  FugaziParseError,
} from '../errors/index.js';

describe('FugaziError base class', () => {
  it('extends the native Error class', () => {
    const err = new FugaziError({ code: 'CONFIG_INVALID_SCHEMA', message: 'boom' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FugaziError);
  });

  it('sets name to FugaziError', () => {
    const err = new FugaziError({ code: 'CONFIG_INVALID_SCHEMA', message: 'boom' });
    expect(err.name).toBe('FugaziError');
  });

  it('exposes code, message, help, and context as readonly fields', () => {
    const err = new FugaziError({
      code: 'CONFIG_INVALID_SCHEMA',
      message: 'schema mismatch',
      help: 'fix the schema',
      context: { key: 'value' },
    });
    expect(err.code).toBe('CONFIG_INVALID_SCHEMA');
    expect(err.message).toBe('schema mismatch');
    expect(err.help).toBe('fix the schema');
    expect(err.context).toEqual({ key: 'value' });
  });

  it('omits help when not supplied (exactOptionalPropertyTypes)', () => {
    const err = new FugaziError({ code: 'CONFIG_INVALID_SCHEMA', message: 'boom' });
    expect('help' in err).toBe(false);
    expect(err.help).toBeUndefined();
  });

  it('omits context when not supplied (exactOptionalPropertyTypes)', () => {
    const err = new FugaziError({ code: 'CONFIG_INVALID_SCHEMA', message: 'boom' });
    expect('context' in err).toBe(false);
    expect(err.context).toBeUndefined();
  });

  it('chains a single cause via the native Error.cause option', () => {
    const root = new Error('root');
    const err = new FugaziError({
      code: 'CONFIG_INVALID_SCHEMA',
      message: 'wrapper',
      cause: root,
    });
    expect(err.cause).toBe(root);
  });

  it('walks a 3-level cause chain', () => {
    const a = new Error('a');
    const b = new FugaziError({ code: 'CONFIG_INVALID_SCHEMA', message: 'b', cause: a });
    const c = new FugaziError({ code: 'CONFIG_INVALID_SCHEMA', message: 'c', cause: b });
    expect(c.cause).toBe(b);
    expect((c.cause as FugaziError).cause).toBe(a);
    expect(((c.cause as FugaziError).cause as Error).message).toBe('a');
  });

  it('has a proper FugaziErrorArgs shape exported as a type', () => {
    expectTypeOf<FugaziErrorArgs>().toMatchTypeOf<{
      readonly code: string;
      readonly message: string;
    }>();
  });
});

describe('FugaziConfigError', () => {
  it('extends FugaziError', () => {
    const err = new FugaziConfigError({ code: 'CONFIG_INVALID_SCHEMA', message: 'bad' });
    expect(err).toBeInstanceOf(FugaziError);
    expect(err).toBeInstanceOf(FugaziConfigError);
  });

  it('has name FugaziConfigError', () => {
    const err = new FugaziConfigError({ code: 'CONFIG_INVALID_SCHEMA', message: 'bad' });
    expect(err.name).toBe('FugaziConfigError');
  });

  it('narrows code to ConfigErrorCode at the type level', () => {
    // @ts-expect-error — PARSE_SYNTAX_ERROR is not a ConfigErrorCode
    const _bad = new FugaziConfigError({ code: 'PARSE_SYNTAX_ERROR', message: 'x' });
    void _bad;
  });
});

describe('FugaziParseError', () => {
  it('extends FugaziError', () => {
    const err = new FugaziParseError({ code: 'PARSE_SYNTAX_ERROR', message: 'bad' });
    expect(err).toBeInstanceOf(FugaziError);
    expect(err).toBeInstanceOf(FugaziParseError);
  });

  it('has name FugaziParseError', () => {
    const err = new FugaziParseError({ code: 'PARSE_SYNTAX_ERROR', message: 'bad' });
    expect(err.name).toBe('FugaziParseError');
  });

  it('accepts WASM_INTEGRITY (SC-19)', () => {
    const err = new FugaziParseError({ code: 'WASM_INTEGRITY', message: 'tampered blob' });
    expect(err.code).toBe('WASM_INTEGRITY');
  });

  it('narrows code to ParseErrorCode at the type level', () => {
    // @ts-expect-error — CONFIG_INVALID_SCHEMA is not a ParseErrorCode
    const _bad = new FugaziParseError({ code: 'CONFIG_INVALID_SCHEMA', message: 'x' });
    void _bad;
  });
});

describe('FugaziCacheError', () => {
  it('extends FugaziError', () => {
    const err = new FugaziCacheError({ code: 'CACHE_VERSION_MISMATCH', message: 'bad' });
    expect(err).toBeInstanceOf(FugaziError);
    expect(err).toBeInstanceOf(FugaziCacheError);
  });

  it('has name FugaziCacheError', () => {
    const err = new FugaziCacheError({ code: 'CACHE_VERSION_MISMATCH', message: 'bad' });
    expect(err.name).toBe('FugaziCacheError');
  });

  it('narrows code to CacheErrorCode at the type level', () => {
    // @ts-expect-error — PARSE_SYNTAX_ERROR is not a CacheErrorCode
    const _bad = new FugaziCacheError({ code: 'PARSE_SYNTAX_ERROR', message: 'x' });
    void _bad;
  });
});

describe('FugaziGraphError', () => {
  it('extends FugaziError', () => {
    const err = new FugaziGraphError({ code: 'GRAPH_CYCLE_DETECTED', message: 'cycle' });
    expect(err).toBeInstanceOf(FugaziError);
    expect(err).toBeInstanceOf(FugaziGraphError);
  });

  it('has name FugaziGraphError', () => {
    const err = new FugaziGraphError({ code: 'GRAPH_CYCLE_DETECTED', message: 'cycle' });
    expect(err.name).toBe('FugaziGraphError');
  });

  it('narrows code to GraphErrorCode at the type level', () => {
    // @ts-expect-error — PARSE_SYNTAX_ERROR is not a GraphErrorCode
    const _bad = new FugaziGraphError({ code: 'PARSE_SYNTAX_ERROR', message: 'x' });
    void _bad;
  });
});

describe('FugaziAnalysisError', () => {
  it('extends FugaziError', () => {
    const err = new FugaziAnalysisError({
      code: 'ANALYSIS_BOUNDARY_VIOLATION',
      message: 'boundary',
    });
    expect(err).toBeInstanceOf(FugaziError);
    expect(err).toBeInstanceOf(FugaziAnalysisError);
  });

  it('has name FugaziAnalysisError', () => {
    const err = new FugaziAnalysisError({
      code: 'ANALYSIS_BOUNDARY_VIOLATION',
      message: 'boundary',
    });
    expect(err.name).toBe('FugaziAnalysisError');
  });

  it('narrows code to AnalysisErrorCode at the type level', () => {
    // @ts-expect-error — CONFIG_INVALID_SCHEMA is not an AnalysisErrorCode
    const _bad = new FugaziAnalysisError({ code: 'CONFIG_INVALID_SCHEMA', message: 'x' });
    void _bad;
  });
});

describe('FugaziLspError', () => {
  it('extends FugaziError', () => {
    const err = new FugaziLspError({ code: 'LSP_REQUEST_CANCELED', message: 'canceled' });
    expect(err).toBeInstanceOf(FugaziError);
    expect(err).toBeInstanceOf(FugaziLspError);
  });

  it('has name FugaziLspError', () => {
    const err = new FugaziLspError({ code: 'LSP_REQUEST_CANCELED', message: 'canceled' });
    expect(err.name).toBe('FugaziLspError');
  });

  it('narrows code to LspErrorCode at the type level', () => {
    // @ts-expect-error — PARSE_SYNTAX_ERROR is not an LspErrorCode
    const _bad = new FugaziLspError({ code: 'PARSE_SYNTAX_ERROR', message: 'x' });
    void _bad;
  });
});

describe('FugaziMcpError', () => {
  it('extends FugaziError', () => {
    const err = new FugaziMcpError({ code: 'MCP_VALIDATION_ENVELOPE', message: 'envelope' });
    expect(err).toBeInstanceOf(FugaziError);
    expect(err).toBeInstanceOf(FugaziMcpError);
  });

  it('has name FugaziMcpError', () => {
    const err = new FugaziMcpError({ code: 'MCP_VALIDATION_ENVELOPE', message: 'envelope' });
    expect(err.name).toBe('FugaziMcpError');
  });

  it('narrows code to McpErrorCode at the type level', () => {
    // @ts-expect-error — PARSE_SYNTAX_ERROR is not a McpErrorCode
    const _bad = new FugaziMcpError({ code: 'PARSE_SYNTAX_ERROR', message: 'x' });
    void _bad;
  });
});

describe('All subclasses preserve the FugaziError instanceof relationship', () => {
  it('every subclass instance is an instanceof FugaziError', () => {
    const errs: readonly FugaziError[] = [
      new FugaziConfigError({ code: 'CONFIG_INVALID_SCHEMA', message: 'a' }),
      new FugaziParseError({ code: 'PARSE_SYNTAX_ERROR', message: 'b' }),
      new FugaziCacheError({ code: 'CACHE_VERSION_MISMATCH', message: 'c' }),
      new FugaziGraphError({ code: 'GRAPH_CYCLE_DETECTED', message: 'd' }),
      new FugaziAnalysisError({ code: 'ANALYSIS_BOUNDARY_VIOLATION', message: 'e' }),
      new FugaziLspError({ code: 'LSP_REQUEST_CANCELED', message: 'f' }),
      new FugaziMcpError({ code: 'MCP_VALIDATION_ENVELOPE', message: 'g' }),
    ];
    for (const err of errs) {
      expect(err).toBeInstanceOf(FugaziError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('subclass name fields match their declared class names verbatim (E5 + IMP-DX-08)', () => {
    expect(new FugaziConfigError({ code: 'CONFIG_INVALID_SCHEMA', message: 'a' }).name).toBe(
      'FugaziConfigError',
    );
    expect(new FugaziParseError({ code: 'PARSE_SYNTAX_ERROR', message: 'b' }).name).toBe(
      'FugaziParseError',
    );
    expect(new FugaziCacheError({ code: 'CACHE_VERSION_MISMATCH', message: 'c' }).name).toBe(
      'FugaziCacheError',
    );
    expect(new FugaziGraphError({ code: 'GRAPH_CYCLE_DETECTED', message: 'd' }).name).toBe(
      'FugaziGraphError',
    );
    expect(
      new FugaziAnalysisError({ code: 'ANALYSIS_BOUNDARY_VIOLATION', message: 'e' }).name,
    ).toBe('FugaziAnalysisError');
    expect(new FugaziLspError({ code: 'LSP_REQUEST_CANCELED', message: 'f' }).name).toBe(
      'FugaziLspError',
    );
    expect(new FugaziMcpError({ code: 'MCP_VALIDATION_ENVELOPE', message: 'g' }).name).toBe(
      'FugaziMcpError',
    );
  });

  it('subclasses propagate cause chain through FugaziError base', () => {
    const root = new Error('root cause');
    const wrapped = new FugaziConfigError({
      code: 'CONFIG_PARSE_FAILED',
      message: 'config parse failed',
      cause: root,
    });
    expect(wrapped.cause).toBe(root);
  });

  it('subclasses preserve help and context fields when supplied', () => {
    const err = new FugaziGraphError({
      code: 'GRAPH_REEXPORT_ITERATION_CAP',
      message: 'iteration cap reached',
      help: 'reduce barrel depth',
      context: { iterations: 20 },
    });
    expect(err.help).toBe('reduce barrel depth');
    expect(err.context).toEqual({ iterations: 20 });
  });
});
