/**
 * sarif.test.ts — Phase 3j — SarifReporter byte-equal output assertions.
 */

import { describe, expect, it } from 'vitest';
import { SarifReporter } from '../sarif.js';
import { SAMPLE_EVENTS, SAMPLE_ISSUES, SAMPLE_META } from './fixtures/sample-issues.js';
import { runReporter, shuffle } from './helpers.js';

interface SarifShape {
  $schema: string;
  version: string;
  runs: ReadonlyArray<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: ReadonlyArray<{ id: string; shortDescription: { text: string }; helpUri: string }>;
      };
    };
    results: ReadonlyArray<{
      ruleId: string;
      level: string;
      message: { text: string };
      locations: ReadonlyArray<{
        physicalLocation: {
          artifactLocation: { uri: string };
          region: {
            startLine: number;
            startColumn: number;
            endLine: number;
            endColumn: number;
          };
        };
      }>;
    }>;
  }>;
}

describe('SarifReporter', () => {
  it('1. empty issue list emits a well-formed SARIF document', () => {
    const r = new SarifReporter();
    const out = runReporter(r, SAMPLE_META, [], []);
    const parsed = JSON.parse(out) as SarifShape;
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0]?.tool.driver.name).toBe('fugazi');
    expect(parsed.runs[0]?.results.length).toBe(0);
    expect(parsed.runs[0]?.tool.driver.rules.length).toBe(0);
  });

  it('2. fixture renders all three issues + corresponding rule definitions', () => {
    const r = new SarifReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    const parsed = JSON.parse(out) as SarifShape;
    expect(parsed.runs[0]?.results.length).toBe(3);
    // Three distinct rule kinds.
    expect(parsed.runs[0]?.tool.driver.rules.length).toBe(3);
    // Sorted, so first result is a.ts:10 unused-exports.
    const first = parsed.runs[0]?.results[0];
    expect(first?.ruleId).toBe('unused-exports');
    expect(first?.level).toBe('error');
    expect(first?.locations[0]?.physicalLocation.artifactLocation.uri).toBe('src/a.ts');
    expect(first?.locations[0]?.physicalLocation.region.startLine).toBe(10);
    expect(first?.locations[0]?.physicalLocation.region.startColumn).toBe(1);
  });

  it('3. severity mapping: error → error, warn → warning, off → note', () => {
    const r = new SarifReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as SarifShape;
    const levels = parsed.runs[0]?.results.map((x) => x.level) ?? [];
    expect(levels).toEqual(['error', 'warning', 'note']);
  });

  it('4. determinism — 50 iterations all produce byte-equal output', () => {
    const baseline = runReporter(new SarifReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let i = 0; i < 50; i++) {
      const out = runReporter(new SarifReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('5. shuffled-input issue list still sorts to the same output', () => {
    const baseline = runReporter(new SarifReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = shuffle(SAMPLE_ISSUES, seed);
      const out = runReporter(new SarifReporter(), SAMPLE_META, shuffled, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('6. tool.driver.rules has helpUri pointing to https://fugazi.dev/rules/<id>', () => {
    const r = new SarifReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as SarifShape;
    for (const rule of parsed.runs[0]?.tool.driver.rules ?? []) {
      expect(rule.helpUri).toBe(`https://fugazi.dev/rules/${rule.id}`);
    }
  });

  it('7. SARIF schema URI is the canonical schemastore URL', () => {
    const r = new SarifReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as SarifShape;
    expect(parsed.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
  });

  it('8. tool driver carries the meta version verbatim', () => {
    const r = new SarifReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as SarifShape;
    expect(parsed.runs[0]?.tool.driver.version).toBe('1.2.3');
  });

  it('9. rules array is unique per ruleId (no duplicates)', () => {
    const r = new SarifReporter();
    // Emit two of the same kind to verify dedupe.
    const dupes = [SAMPLE_ISSUES[1], SAMPLE_ISSUES[1]] as never[];
    const out = runReporter(r, SAMPLE_META, dupes, []);
    const parsed = JSON.parse(out) as SarifShape;
    expect(parsed.runs[0]?.tool.driver.rules.length).toBe(1);
    expect(parsed.runs[0]?.results.length).toBe(2);
  });

  it('10. trailing LF is part of contract', () => {
    const r = new SarifReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out.endsWith('\n')).toBe(true);
  });
});
