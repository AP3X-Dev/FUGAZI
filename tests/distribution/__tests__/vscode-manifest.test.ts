/**
 * VS Code extension manifest validation.
 *
 * Mirrors what `vsce package` would catch, so we can verify the manifest
 * shape without depending on `@vscode/vsce` being installed locally.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MANIFEST = JSON.parse(
  readFileSync(join(REPO_ROOT, 'editors', 'vscode', 'package.json'), 'utf8'),
) as Record<string, unknown>;

describe('VS Code extension manifest', () => {
  it('declares engines.vscode', () => {
    const engines = MANIFEST.engines as { vscode?: string } | undefined;
    expect(engines?.vscode).toBeTruthy();
    expect(engines?.vscode).toMatch(/^\^?\d+\.\d+\.\d+$/);
  });

  it('points main at the bundled output', () => {
    expect(MANIFEST.main).toBe('./dist/extension.js');
  });

  it('activates on TS / JS file open and on the runAnalysis command', () => {
    const events = MANIFEST.activationEvents as string[];
    expect(events).toContain('onLanguage:typescript');
    expect(events).toContain('onLanguage:typescriptreact');
    expect(events).toContain('onLanguage:javascript');
    expect(events).toContain('onLanguage:javascriptreact');
    expect(events).toContain('onCommand:fugazi.runAnalysis');
  });

  it('contributes the four required commands', () => {
    const contributes = MANIFEST.contributes as { commands: { command: string }[] };
    const ids = contributes.commands.map((c) => c.command);
    expect(ids).toContain('fugazi.runAnalysis');
    expect(ids).toContain('fugazi.applyFix');
    expect(ids).toContain('fugazi.openIssue');
    expect(ids).toContain('fugazi.toggleHotPaths');
  });

  it('does NOT contribute fugazi.autoDownload (F6 / IMP-DX-03)', () => {
    const contributes = MANIFEST.contributes as {
      configuration: { properties: Record<string, unknown> };
    };
    const keys = Object.keys(contributes.configuration.properties);
    expect(keys).not.toContain('fugazi.autoDownload');
  });

  it('does NOT contribute fugazi.lspPath (FR-J5)', () => {
    const contributes = MANIFEST.contributes as {
      configuration: { properties: Record<string, unknown> };
    };
    const keys = Object.keys(contributes.configuration.properties);
    expect(keys).not.toContain('fugazi.lspPath');
  });

  it('contributes the three tree views', () => {
    const contributes = MANIFEST.contributes as {
      views: { explorer: { id: string }[] };
    };
    const ids = contributes.views.explorer.map((v) => v.id);
    expect(ids).toContain('fugaziIssues');
    expect(ids).toContain('fugaziDuplicates');
    expect(ids).toContain('fugaziHealth');
  });

  it('depends on vscode-languageclient', () => {
    const deps = MANIFEST.dependencies as Record<string, string>;
    expect(deps['vscode-languageclient']).toBeTruthy();
  });

  it('configures known severity values for severityOverrides', () => {
    const props = (
      MANIFEST.contributes as {
        configuration: { properties: Record<string, unknown> };
      }
    ).configuration.properties;
    const sev = props['fugazi.severityOverrides'] as {
      additionalProperties?: { enum?: string[] };
    };
    expect(sev?.additionalProperties?.enum).toEqual(['error', 'warn', 'off']);
  });

  it('uses the icon at icons/icon.png', () => {
    expect(MANIFEST.icon).toBe('icons/icon.png');
  });
});
