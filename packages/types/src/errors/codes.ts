/**
 * codes.ts — string-literal unions of every ErrorCode in Fugazi.
 *
 * Each per-package union is its own exported type; the umbrella `ErrorCode`
 * is the union of all per-package unions plus `FsErrorCode`. Per SC-17, no
 * forbidden tokens may appear in any literal value here.
 */

export type ConfigErrorCode =
  | 'CONFIG_INVALID_SCHEMA'
  | 'CONFIG_EXTENDS_DEPTH_EXCEEDED'
  | 'CONFIG_EXTENDS_PROTOCOL_REJECTED'
  | 'CONFIG_PATH_TRAVERSAL'
  | 'CONFIG_PROTOTYPE_POLLUTION'
  | 'CONFIG_FILE_NOT_FOUND'
  | 'CONFIG_PARSE_FAILED';

export type ParseErrorCode =
  | 'PARSE_SYNTAX_ERROR'
  | 'PARSE_TIMEOUT'
  | 'PARSE_UNSUPPORTED_LANGUAGE'
  | 'WASM_INTEGRITY'
  | 'WASM_MISSING';

export type CacheErrorCode =
  | 'CACHE_VERSION_MISMATCH'
  | 'CACHE_LOCK_TIMEOUT'
  | 'CACHE_CORRUPTED'
  | 'CACHE_WRITE_FAILED';

export type GraphErrorCode =
  | 'GRAPH_REEXPORT_ITERATION_CAP'
  | 'GRAPH_CYCLE_DETECTED'
  | 'GRAPH_RESOLVE_FAILED'
  | 'GRAPH_PEER_DEP_CYCLE'
  | 'GIT_TOPLEVEL_FAILED'
  | 'CHANGED_SINCE_FAILED';

export type AnalysisErrorCode =
  | 'ANALYSIS_BOUNDARY_VIOLATION'
  | 'ANALYSIS_INVALID_RULE'
  | 'ANALYSIS_FIXTURE_MISMATCH';

export type LspErrorCode = 'LSP_REQUEST_CANCELED' | 'LSP_INIT_FAILED';

export type McpErrorCode = 'MCP_VALIDATION_ENVELOPE' | 'MCP_TOOL_UNKNOWN' | 'MCP_TIMEOUT';

export type RuntimeErrorCode = 'RUNTIME_COVERAGE_PARSE_FAILED' | 'RUNTIME_PATH_REBASE_AMBIGUOUS';

export type CoverageErrorCode =
  | 'COVERAGE_PARSE_MALFORMED'
  | 'COVERAGE_FILE_READ_FAILED'
  | 'COVERAGE_REBASE_UNMAPPED';

export type FsErrorCode = 'FS_PATH_NOT_FOUND';

export type ErrorCode =
  | ConfigErrorCode
  | ParseErrorCode
  | CacheErrorCode
  | GraphErrorCode
  | AnalysisErrorCode
  | LspErrorCode
  | McpErrorCode
  | RuntimeErrorCode
  | CoverageErrorCode
  | FsErrorCode;
