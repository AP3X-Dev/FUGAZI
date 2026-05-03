/**
 * GitLab CI template + script validation. Mirrors the bats coverage in
 * `ci/tests/` so distribution contracts are enforced even when bats is
 * not installed locally.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CI_DIR = join(REPO_ROOT, 'ci');

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('.gitlab-ci.yml', () => {
  const yaml = readText(join(CI_DIR, '.gitlab-ci.yml'));

  it('declares the fugazi-audit job', () => {
    expect(yaml).toMatch(/^fugazi-audit:/m);
  });

  it('uploads code-quality artefact', () => {
    expect(yaml).toContain('reports:');
    expect(yaml).toContain('codequality: gl-code-quality-report.json');
  });

  it('runs on merge requests and on the default branch', () => {
    expect(yaml).toContain('CI_PIPELINE_SOURCE == "merge_request_event"');
    expect(yaml).toContain('CI_DEFAULT_BRANCH');
  });

  it('declares only FUGAZI_ variables (no FALLOW_)', () => {
    expect(yaml).toMatch(/FUGAZI_VERSION:/);
    expect(yaml).toMatch(/FUGAZI_FORMAT:/);
    expect(yaml).toMatch(/FUGAZI_FAIL_ON_ISSUES:/);
    expect(yaml).not.toMatch(/\bFALLOW_/);
  });
});

describe('ci scripts', () => {
  const scripts = ['install.sh', 'analyse.sh', 'mr-review.sh'];

  it('every script has a bash shebang and set -euo pipefail', () => {
    for (const name of scripts) {
      const text = readText(join(CI_DIR, 'scripts', name));
      expect(text.startsWith('#!/usr/bin/env bash')).toBe(true);
      expect(text).toContain('set -euo pipefail');
    }
  });

  it('uses only FUGAZI_ env vars (no FALLOW_)', () => {
    for (const name of scripts) {
      const text = readText(join(CI_DIR, 'scripts', name));
      expect(text).not.toMatch(/\bFALLOW_/);
    }
  });

  it('analyse.sh emits codeclimate JSON to gl-code-quality-report.json', () => {
    const text = readText(join(CI_DIR, 'scripts', 'analyse.sh'));
    expect(text).toContain('--format codeclimate');
    expect(text).toContain('gl-code-quality-report.json');
  });

  it('mr-review.sh uses the GitLab API endpoint', () => {
    const text = readText(join(CI_DIR, 'scripts', 'mr-review.sh'));
    expect(text).toContain('CI_API_V4_URL');
    expect(text).toContain('CI_MERGE_REQUEST_IID');
    expect(text).toContain('merge_requests');
  });
});

describe('ci jq filters', () => {
  const filters = [
    'review-body.jq',
    'review-comments-check.jq',
    'review-comments-dupes.jq',
    'review-comments-health.jq',
  ];

  it('every filter exists and is non-empty', () => {
    for (const name of filters) {
      const text = readText(join(CI_DIR, 'jq', name));
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('review-comments-check.jq emits position objects (GitLab discussion shape)', () => {
    const text = readText(join(CI_DIR, 'jq', 'review-comments-check.jq'));
    expect(text).toContain('position_type');
    expect(text).toContain('new_path');
    expect(text).toContain('new_line');
  });
});
