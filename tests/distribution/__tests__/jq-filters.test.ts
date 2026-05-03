/**
 * Mirror of the bats jq-filter coverage as Vitest tests.
 *
 * jq is invoked via `child_process.spawnSync`. If jq isn't on PATH we skip
 * the suite — the bats tests will still cover this in CI environments
 * that install jq, and the github-action / gitlab-ci tests already cover
 * the shape of the filters via static text assertions.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function jqAvailable(): boolean {
  const r = spawnSync('jq', ['--version'], { stdio: 'pipe' });
  return r.status === 0;
}

function runJq(filter: string, json: string, raw = false): string {
  const args = raw ? ['-r', '-f', filter, json] : ['-c', '-f', filter, json];
  const r = spawnSync('jq', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`jq failed (${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

const HAS_JQ = jqAvailable();
const describeIfJq = HAS_JQ ? describe : describe.skip;

describeIfJq('action/jq filters (Vitest mirror of bats)', () => {
  const sample = join(REPO_ROOT, 'action', 'tests', 'fixtures', 'sample-issues.json');
  const empty = join(REPO_ROOT, 'action', 'tests', 'fixtures', 'empty-issues.json');
  const jq = (name: string): string => join(REPO_ROOT, 'action', 'jq', name);

  it('review-body.jq renders header and totals', () => {
    const out = runJq(jq('review-body.jq'), sample, true);
    expect(out).toContain('## Fugazi report');
    expect(out).toContain('**Total issues:** 3');
  });

  it("review-body.jq says 'No issues found' on empty input", () => {
    const out = runJq(jq('review-body.jq'), empty, true);
    expect(out).toContain('No issues found.');
  });

  it('summary-dupes.jq lists clone families', () => {
    const out = runJq(jq('summary-dupes.jq'), sample, true);
    expect(out).toContain('## Duplication summary');
    expect(out).toContain('**Clone families:** 1');
    expect(out).toContain('F1');
  });

  it('summary-fix.jq lists fixable issues only', () => {
    const out = runJq(jq('summary-fix.jq'), sample, true);
    expect(out).toContain('unused-export');
    expect(out).toContain('unused-deps');
    expect(out).not.toContain('complexity');
  });

  it('review-comments-check.jq filters to category=check', () => {
    const out = runJq(jq('review-comments-check.jq'), sample);
    const arr = JSON.parse(out) as unknown[];
    expect(arr.length).toBe(2);
  });

  it('review-comments-health.jq filters to category=health', () => {
    const out = runJq(jq('review-comments-health.jq'), sample);
    const arr = JSON.parse(out) as unknown[];
    expect(arr.length).toBe(1);
  });

  it('merge-comments.jq deduplicates by (path,line,body)', () => {
    const input = JSON.stringify([
      { path: 'a.ts', line: 1, body: 'x' },
      { path: 'a.ts', line: 1, body: 'x' },
      { path: 'a.ts', line: 2, body: 'x' },
    ]);
    const r = spawnSync('jq', ['-f', jq('merge-comments.jq')], {
      encoding: 'utf8',
      input,
    });
    expect(r.status).toBe(0);
    const arr = JSON.parse(r.stdout) as unknown[];
    expect(arr.length).toBe(2);
  });
});

describeIfJq('ci/jq filters (Vitest mirror of bats)', () => {
  const sample = join(REPO_ROOT, 'ci', 'tests', 'fixtures', 'sample-issues.json');
  const jq = (name: string): string => join(REPO_ROOT, 'ci', 'jq', name);

  it('review-body.jq renders header', () => {
    const out = runJq(jq('review-body.jq'), sample, true);
    expect(out).toContain('## Fugazi report');
  });

  it('review-comments-check.jq emits text-position objects', () => {
    const out = runJq(jq('review-comments-check.jq'), sample);
    const arr = JSON.parse(out) as Array<{ position?: { position_type?: string } }>;
    expect(arr.length).toBe(1);
    expect(arr[0]?.position?.position_type).toBe('text');
  });

  it('review-comments-dupes.jq expands clone instances', () => {
    const out = runJq(jq('review-comments-dupes.jq'), sample);
    const arr = JSON.parse(out) as unknown[];
    expect(arr.length).toBe(2);
  });

  it('review-comments-health.jq filters by category=health', () => {
    const out = runJq(jq('review-comments-health.jq'), sample);
    const arr = JSON.parse(out) as unknown[];
    expect(arr.length).toBe(1);
  });
});

describe('action/jq filters (text-only assertions, always run)', () => {
  // These run regardless of jq availability.
  it('review-body.jq and ci/jq/review-body.jq agree on shape', () => {
    const a = readFileSync(join(REPO_ROOT, 'action', 'jq', 'review-body.jq'), 'utf8');
    const b = readFileSync(join(REPO_ROOT, 'ci', 'jq', 'review-body.jq'), 'utf8');
    // The two filters must produce the same Markdown body — we copied the
    // text exactly. If they diverge a future maintainer should update both.
    expect(a).toBe(b);
  });
});
