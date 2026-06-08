import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AnalysisErrorCode,
  CacheErrorCode,
  ConfigErrorCode,
  ErrorCode,
  FsErrorCode,
  GraphErrorCode,
  LspErrorCode,
  McpErrorCode,
  ParseErrorCode,
  RuntimeErrorCode,
} from '../errors/index.js';

// Codes pinned by the plan (T024-test). String-literal values committed verbatim.
const REQUIRED_CONFIG_CODES = [
  'CONFIG_INVALID_SCHEMA',
  'CONFIG_EXTENDS_DEPTH_EXCEEDED',
  'CONFIG_EXTENDS_PROTOCOL_REJECTED',
  'CONFIG_PATH_TRAVERSAL',
  'CONFIG_PROTOTYPE_POLLUTION',
  'CONFIG_FILE_NOT_FOUND',
  'CONFIG_PARSE_FAILED',
] as const satisfies readonly ConfigErrorCode[];

const REQUIRED_PARSE_CODES = [
  'PARSE_SYNTAX_ERROR',
  'PARSE_TIMEOUT',
  'PARSE_UNSUPPORTED_LANGUAGE',
  'WASM_INTEGRITY',
  'WASM_MISSING',
] as const satisfies readonly ParseErrorCode[];

const REQUIRED_CACHE_CODES = [
  'CACHE_VERSION_MISMATCH',
  'CACHE_LOCK_TIMEOUT',
  'CACHE_CORRUPTED',
  'CACHE_WRITE_FAILED',
] as const satisfies readonly CacheErrorCode[];

const REQUIRED_GRAPH_CODES = [
  'GRAPH_REEXPORT_ITERATION_CAP',
  'GRAPH_CYCLE_DETECTED',
  'GRAPH_RESOLVE_FAILED',
  'GRAPH_PEER_DEP_CYCLE',
  'GIT_TOPLEVEL_FAILED',
  'CHANGED_SINCE_FAILED',
] as const satisfies readonly GraphErrorCode[];

const REQUIRED_ANALYSIS_CODES = [
  'ANALYSIS_BOUNDARY_VIOLATION',
  'ANALYSIS_INVALID_RULE',
  'ANALYSIS_FIXTURE_MISMATCH',
] as const satisfies readonly AnalysisErrorCode[];

const REQUIRED_LSP_CODES = [
  'LSP_REQUEST_CANCELED',
  'LSP_INIT_FAILED',
] as const satisfies readonly LspErrorCode[];

const REQUIRED_MCP_CODES = [
  'MCP_VALIDATION_ENVELOPE',
  'MCP_TOOL_UNKNOWN',
  'MCP_TIMEOUT',
] as const satisfies readonly McpErrorCode[];

const REQUIRED_RUNTIME_CODES = [
  'RUNTIME_COVERAGE_PARSE_FAILED',
  'RUNTIME_PATH_REBASE_AMBIGUOUS',
] as const satisfies readonly RuntimeErrorCode[];

const REQUIRED_FS_CODES = ['FS_PATH_NOT_FOUND'] as const satisfies readonly FsErrorCode[];

const ALL_REQUIRED_CODES: readonly ErrorCode[] = [
  ...REQUIRED_CONFIG_CODES,
  ...REQUIRED_PARSE_CODES,
  ...REQUIRED_CACHE_CODES,
  ...REQUIRED_GRAPH_CODES,
  ...REQUIRED_ANALYSIS_CODES,
  ...REQUIRED_LSP_CODES,
  ...REQUIRED_MCP_CODES,
  ...REQUIRED_RUNTIME_CODES,
  ...REQUIRED_FS_CODES,
];

const VALID_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

describe('ConfigErrorCode', () => {
  it('contains the required entries from spec', () => {
    expect(REQUIRED_CONFIG_CODES).toContain('CONFIG_INVALID_SCHEMA');
    expect(REQUIRED_CONFIG_CODES).toContain('CONFIG_EXTENDS_DEPTH_EXCEEDED');
    expect(REQUIRED_CONFIG_CODES).toContain('CONFIG_EXTENDS_PROTOCOL_REJECTED');
    expect(REQUIRED_CONFIG_CODES).toContain('CONFIG_PATH_TRAVERSAL');
    expect(REQUIRED_CONFIG_CODES).toContain('CONFIG_PROTOTYPE_POLLUTION');
  });

  it('every code matches the uppercase pattern', () => {
    for (const code of REQUIRED_CONFIG_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
    }
  });
});

describe('ParseErrorCode', () => {
  it('contains WASM_INTEGRITY (SC-19)', () => {
    expect(REQUIRED_PARSE_CODES).toContain('WASM_INTEGRITY');
  });

  it('contains WASM_MISSING (SC-19, manifest/path coverage)', () => {
    expect(REQUIRED_PARSE_CODES).toContain('WASM_MISSING');
  });

  it('contains the required entries from spec', () => {
    expect(REQUIRED_PARSE_CODES).toContain('PARSE_SYNTAX_ERROR');
    expect(REQUIRED_PARSE_CODES).toContain('PARSE_TIMEOUT');
  });

  it('every code matches the uppercase pattern', () => {
    for (const code of REQUIRED_PARSE_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
    }
  });
});

describe('CacheErrorCode', () => {
  it('contains the required entries from spec', () => {
    expect(REQUIRED_CACHE_CODES).toContain('CACHE_VERSION_MISMATCH');
    expect(REQUIRED_CACHE_CODES).toContain('CACHE_LOCK_TIMEOUT');
  });

  it('every code matches the uppercase pattern', () => {
    for (const code of REQUIRED_CACHE_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
    }
  });
});

describe('GraphErrorCode', () => {
  it('contains the required entries from spec', () => {
    expect(REQUIRED_GRAPH_CODES).toContain('GRAPH_REEXPORT_ITERATION_CAP');
    expect(REQUIRED_GRAPH_CODES).toContain('GRAPH_CYCLE_DETECTED');
  });

  it('every code matches the uppercase pattern', () => {
    for (const code of REQUIRED_GRAPH_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
    }
  });
});

describe('AnalysisErrorCode', () => {
  it('contains ANALYSIS_BOUNDARY_VIOLATION', () => {
    expect(REQUIRED_ANALYSIS_CODES).toContain('ANALYSIS_BOUNDARY_VIOLATION');
  });

  it('every code matches the uppercase pattern', () => {
    for (const code of REQUIRED_ANALYSIS_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
    }
  });
});

describe('LspErrorCode', () => {
  it('contains LSP_REQUEST_CANCELED', () => {
    expect(REQUIRED_LSP_CODES).toContain('LSP_REQUEST_CANCELED');
  });

  it('every code matches the uppercase pattern', () => {
    for (const code of REQUIRED_LSP_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
    }
  });
});

describe('McpErrorCode', () => {
  it('contains MCP_VALIDATION_ENVELOPE (FR-K4)', () => {
    expect(REQUIRED_MCP_CODES).toContain('MCP_VALIDATION_ENVELOPE');
  });

  it('every code matches the uppercase pattern', () => {
    for (const code of REQUIRED_MCP_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
    }
  });
});

describe('RuntimeErrorCode', () => {
  it('every code matches the uppercase pattern', () => {
    for (const code of REQUIRED_RUNTIME_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
    }
  });
});

describe('FsErrorCode', () => {
  it('contains FS_PATH_NOT_FOUND', () => {
    expect(REQUIRED_FS_CODES).toContain('FS_PATH_NOT_FOUND');
  });
});

describe('ErrorCode umbrella', () => {
  it('every required code is valid (uppercase, [A-Z0-9_] only)', () => {
    for (const code of ALL_REQUIRED_CODES) {
      expect(code).toMatch(VALID_CODE_PATTERN);
      expect(code).not.toContain(' ');
      expect(code).toBe(code.toUpperCase());
    }
  });

  it('contains no duplicates across per-package unions (disjoint at the value level)', () => {
    const seen = new Set<string>();
    for (const code of ALL_REQUIRED_CODES) {
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
  });

  it('accepts WASM_INTEGRITY at the type level', () => {
    const code: ErrorCode = 'WASM_INTEGRITY';
    expect(code).toBe('WASM_INTEGRITY');
  });

  it('rejects lowercase / kebab-case strings at the type level', () => {
    // @ts-expect-error — 'wasm-integrity' is not an ErrorCode
    const _bad: ErrorCode = 'wasm-integrity';
    void _bad;
  });

  it('rejects unknown strings at the type level', () => {
    // @ts-expect-error — 'NOT_A_REAL_CODE' is not in the union
    const _bad: ErrorCode = 'NOT_A_REAL_CODE';
    void _bad;
  });

  it('treats every required value as assignable to ErrorCode (typing pin)', () => {
    expectTypeOf<'WASM_INTEGRITY'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'CONFIG_INVALID_SCHEMA'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'CONFIG_EXTENDS_DEPTH_EXCEEDED'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'CONFIG_EXTENDS_PROTOCOL_REJECTED'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'CONFIG_PATH_TRAVERSAL'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'CONFIG_PROTOTYPE_POLLUTION'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'PARSE_SYNTAX_ERROR'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'PARSE_TIMEOUT'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'CACHE_VERSION_MISMATCH'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'CACHE_LOCK_TIMEOUT'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'GRAPH_REEXPORT_ITERATION_CAP'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'GRAPH_CYCLE_DETECTED'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'ANALYSIS_BOUNDARY_VIOLATION'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'LSP_REQUEST_CANCELED'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'MCP_VALIDATION_ENVELOPE'>().toMatchTypeOf<ErrorCode>();
    expectTypeOf<'FS_PATH_NOT_FOUND'>().toMatchTypeOf<ErrorCode>();
  });

  it('per-package unions do not share values (ConfigErrorCode and ParseErrorCode are disjoint)', () => {
    type Shared = ConfigErrorCode & ParseErrorCode;
    expectTypeOf<Shared>().toEqualTypeOf<never>();
  });

  it('per-package unions do not share values (CacheErrorCode and GraphErrorCode are disjoint)', () => {
    type Shared = CacheErrorCode & GraphErrorCode;
    expectTypeOf<Shared>().toEqualTypeOf<never>();
  });

  it('per-package unions do not share values (LspErrorCode and McpErrorCode are disjoint)', () => {
    type Shared = LspErrorCode & McpErrorCode;
    expectTypeOf<Shared>().toEqualTypeOf<never>();
  });
});
