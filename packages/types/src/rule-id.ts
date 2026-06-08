/**
 * RuleId — the closed string-literal union of every named rule Fugazi can
 * report. The 19 names below are committed verbatim per spec FR-E1 and are
 * the canonical kebab-case identifiers used in:
 *
 *   - config files (rule severity overrides),
 *   - inline suppression comments (// fugazi-ignore-next-line <rule-id>),
 *   - JSON / SARIF / CodeClimate / human reporters,
 *   - LSP diagnostic codes,
 *   - MCP tool result envelopes.
 *
 * Order in this file is the canonical source-listing order from FR-E1; it is
 * NOT the report-emit order (reporters emit path-sorted, then range-sorted).
 *
 * Adding a rule requires bumping the schema version and updating downstream
 * config / reporter / fixture tests.
 */
export type RuleId =
  | 'unused-files'
  | 'unused-exports'
  | 'unused-types'
  | 'unused-deps'
  | 'unused-dev-deps'
  | 'unused-optional-deps'
  | 'unused-enum-members'
  | 'unused-class-members'
  | 'circular-dependencies'
  | 'boundary-violations'
  | 'unresolved-imports'
  | 'unlisted-dependencies'
  | 'duplicate-exports'
  | 'private-type-leak'
  | 'complexity-hotspot'
  | 'cognitive-complexity'
  | 'code-duplication'
  | 'cold-code'
  | 'hot-path';
