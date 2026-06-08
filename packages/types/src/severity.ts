/**
 * Severity — the three diagnostic levels a Fugazi rule can be configured at.
 *
 *   - 'error' — fail CI (default for most rules).
 *   - 'warn'  — surface the issue but exit 0.
 *   - 'off'   — skip the rule entirely.
 *
 * Per spec FR-A1 and SC-15 (output format determinism), severity is a closed
 * string-literal union. New severities require an explicit type bump.
 */
export type Severity = 'error' | 'warn' | 'off';
