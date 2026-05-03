/**
 * common.test.ts — Phase 3j — exercises the shared reporter helpers.
 *
 * The format-specific tests rely on these helpers being correct, so we lock
 * their behavior independently.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import {
  ccCategory,
  ccSeverity,
  compareIssues,
  endColumn,
  endLine,
  groupBy,
  jsonRange,
  relPath,
  sarifLevel,
  sectionOf,
  severityWire,
  sha1Hex,
  sortIssues,
  startColumn,
  startLine,
} from '../common.js';

const issue = (
  kind: DiscriminatedIssue['kind'],
  file: string,
  line?: number,
  col?: number,
): DiscriminatedIssue => {
  if (line === undefined || col === undefined) {
    return { kind, severity: 'warn', file, message: 'msg', path: file } as DiscriminatedIssue;
  }
  return {
    kind,
    severity: 'warn',
    file,
    range: {
      start: { line, column: col, byteOffset: 0 },
      end: { line, column: col + 1, byteOffset: 1 },
    },
    message: 'msg',
    exportName: 'x',
  } as DiscriminatedIssue;
};

describe('reporter common helpers', () => {
  it('1. relPath strips a normalized projectRoot prefix', () => {
    expect(relPath('/tmp/proj/src/a.ts', '/tmp/proj')).toBe('src/a.ts');
    expect(relPath('/tmp/proj/src/a.ts', '/tmp/proj/')).toBe('src/a.ts');
  });

  it('2. relPath returns absolute when not under root', () => {
    expect(relPath('/elsewhere/x.ts', '/tmp/proj')).toBe('/elsewhere/x.ts');
  });

  it('3. relPath normalizes Windows backslashes', () => {
    expect(relPath('C:\\tmp\\proj\\src\\a.ts', 'C:\\tmp\\proj')).toBe('src/a.ts');
  });

  it('4. relPath returns "." when file equals root', () => {
    expect(relPath('/tmp/proj', '/tmp/proj')).toBe('.');
  });

  it('5. startLine / startColumn default to 1 when range absent', () => {
    const u = issue('unused-files', '/x.ts');
    expect(startLine(u)).toBe(1);
    expect(startColumn(u)).toBe(1);
  });

  it('6. endLine / endColumn default to start when range absent', () => {
    const u = issue('unused-files', '/x.ts');
    expect(endLine(u)).toBe(startLine(u));
    expect(endColumn(u)).toBe(startColumn(u));
  });

  it('7. column is 1-indexed wire format from 0-indexed source', () => {
    const u = issue('unused-exports', '/x.ts', 7, 4);
    expect(startColumn(u)).toBe(5);
  });

  it('8. severityWire maps off → note', () => {
    expect(severityWire('error')).toBe('error');
    expect(severityWire('warn')).toBe('warning');
    expect(severityWire('off')).toBe('note');
  });

  it('9. sarifLevel matches severityWire', () => {
    expect(sarifLevel('error')).toBe('error');
    expect(sarifLevel('warn')).toBe('warning');
    expect(sarifLevel('off')).toBe('note');
  });

  it('10. ccSeverity ladder', () => {
    expect(ccSeverity('error')).toBe('major');
    expect(ccSeverity('warn')).toBe('minor');
    expect(ccSeverity('off')).toBe('info');
  });

  it('11. ccCategory routing', () => {
    expect(ccCategory('code-duplication')).toBe('Duplication');
    expect(ccCategory('duplicate-exports')).toBe('Duplication');
    expect(ccCategory('complexity-hotspot')).toBe('Complexity');
    expect(ccCategory('cognitive-complexity')).toBe('Complexity');
    expect(ccCategory('boundary-violations')).toBe('Style');
    expect(ccCategory('unused-files')).toBe('Bug Risk');
  });

  it('12. sectionOf classifies all rule kinds', () => {
    expect(sectionOf('unused-files')).toBe('dead-code');
    expect(sectionOf('duplicate-exports')).toBe('duplicates');
    expect(sectionOf('complexity-hotspot')).toBe('health');
    expect(sectionOf('cold-code')).toBe('runtime');
  });

  it('13. compareIssues orders by file, then line, then col, then ruleId', () => {
    const a = issue('unused-exports', '/x.ts', 1, 0);
    const b = issue('unused-types', '/x.ts', 1, 0);
    expect(compareIssues(a, b)).toBeLessThan(0);
  });

  it('14. sortIssues is stable + deterministic', () => {
    const a = issue('unused-exports', '/b.ts', 5, 0);
    const b = issue('unused-exports', '/a.ts', 5, 0);
    const sorted = sortIssues([a, b]);
    expect(sorted[0]).toBe(b);
    expect(sorted[1]).toBe(a);
  });

  it('15. groupBy preserves insertion order on the keys', () => {
    const a = issue('unused-exports', '/a.ts', 1, 0);
    const b = issue('unused-types', '/a.ts', 2, 0);
    const c = issue('unused-exports', '/a.ts', 3, 0);
    const map = groupBy([a, b, c], (i) => i.kind);
    expect([...map.keys()]).toEqual(['unused-exports', 'unused-types']);
    expect(map.get('unused-exports')?.length).toBe(2);
  });

  it('16. sha1Hex is deterministic', () => {
    expect(sha1Hex('hello')).toBe(sha1Hex('hello'));
    expect(sha1Hex('hello')).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
  });

  it('17. jsonRange handles undefined input', () => {
    expect(jsonRange(undefined)).toEqual({
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
    });
  });

  it('18. jsonRange converts 0-indexed columns to 1-indexed', () => {
    expect(
      jsonRange({
        start: { line: 1, column: 0, byteOffset: 0 },
        end: { line: 1, column: 5, byteOffset: 5 },
      }),
    ).toEqual({ startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 });
  });
});
