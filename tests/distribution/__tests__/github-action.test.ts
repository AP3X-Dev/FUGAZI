/**
 * GitHub Action manifest + script validation.
 *
 * We do not pull a YAML parser dependency — instead we validate the
 * manifest by reading the file as text and asserting against literal
 * substrings, plus a minimal hand-rolled YAML key extractor. This keeps
 * the distribution test surface zero-dep.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ACTION_DIR = join(REPO_ROOT, 'action');

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function topLevelKeys(yaml: string): string[] {
  const out: string[] = [];
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line);
    if (m && line[0] !== ' ') out.push(m[1] ?? '');
  }
  return out;
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === 0x20) n++;
  return n;
}

function listKeysUnder(yaml: string, parent: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  let sectionIndent = 0;
  const head = new RegExp(`^${parent}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!inSection) {
      if (head.test(line)) {
        inSection = true;
        const next = lines[i + 1] ?? '';
        sectionIndent = leadingSpaces(next) || 2;
      }
      continue;
    }
    if (line.length === 0) continue;
    const indent = leadingSpaces(line);
    if (indent === 0) {
      inSection = false;
      continue;
    }
    if (indent === sectionIndent) {
      const m = /^\s+([A-Za-z][A-Za-z0-9_-]*):/.exec(line);
      if (m) out.push(m[1] ?? '');
    }
  }
  return out;
}

describe('action.yml', () => {
  const yaml = readText(join(ACTION_DIR, 'action.yml'));

  it('has the expected top-level keys', () => {
    const keys = topLevelKeys(yaml);
    expect(keys).toContain('name');
    expect(keys).toContain('description');
    expect(keys).toContain('inputs');
    expect(keys).toContain('outputs');
    expect(keys).toContain('runs');
  });

  it('declares all required inputs', () => {
    const inputs = listKeysUnder(yaml, 'inputs');
    expect(inputs).toEqual(
      expect.arrayContaining([
        'fugazi-version',
        'working-directory',
        'format',
        'fail-on-issues',
        'comment-on-pr',
        'upload-sarif',
        'runtime-coverage',
      ]),
    );
  });

  it("declares 'composite' runs.using", () => {
    expect(yaml).toMatch(/using:\s*'composite'/);
  });

  it('references github/codeql-action/upload-sarif@v3', () => {
    expect(yaml).toContain('github/codeql-action/upload-sarif@v3');
  });

  it('contains no FALLOW_ env reads', () => {
    expect(yaml).not.toMatch(/\bFALLOW_/);
  });
});

describe('action scripts', () => {
  const scripts = [
    'install.sh',
    'analyse.sh',
    'annotate.sh',
    'pr-comment.sh',
    'pr-review.sh',
    'upload-sarif.sh',
  ];

  it('every script has a bash shebang and set -euo pipefail', () => {
    for (const name of scripts) {
      const text = readText(join(ACTION_DIR, 'scripts', name));
      expect(text.startsWith('#!/usr/bin/env bash')).toBe(true);
      expect(text).toContain('set -euo pipefail');
    }
  });

  it('uses only FUGAZI_ env vars (no FALLOW_)', () => {
    for (const name of scripts) {
      const text = readText(join(ACTION_DIR, 'scripts', name));
      expect(text).not.toMatch(/\bFALLOW_/);
    }
  });

  it('install.sh installs via npm or bun, not curl-bash', () => {
    const text = readText(join(ACTION_DIR, 'scripts', 'install.sh'));
    expect(text).toContain('npm install -g');
    expect(text).not.toContain('curl -fsSL https://');
  });

  it('annotate.sh emits ::error and ::warning workflow commands', () => {
    const text = readText(join(ACTION_DIR, 'scripts', 'annotate.sh'));
    expect(text).toContain('::error file=');
    expect(text).toContain('::warning file=');
  });

  it('upload-sarif.sh writes the SARIF artefact', () => {
    const text = readText(join(ACTION_DIR, 'scripts', 'upload-sarif.sh'));
    expect(text).toContain('--format sarif');
    expect(text).toContain('fugazi.sarif');
  });
});

describe('action jq filters', () => {
  const filters = [
    'review-body.jq',
    'summary-dupes.jq',
    'summary-fix.jq',
    'merge-comments.jq',
    'review-comments-check.jq',
    'review-comments-health.jq',
  ];

  it('every filter exists and is non-empty', () => {
    for (const name of filters) {
      const text = readText(join(ACTION_DIR, 'jq', name));
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
