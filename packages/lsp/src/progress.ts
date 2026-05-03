/**
 * progress.ts — Phase 3h.3 (T190) — workDoneProgress wrapper.
 *
 * Wraps the runAnalysis `onProgress` callback (a stream of `ProgressEvent`s
 * with monotonic `seq`) into LSP `WorkDoneProgressBegin/Report/End` notifications
 * per IMP-OBS-04.
 *
 * The wrapper is intentionally pure — it takes a `Reporter` interface
 * abstracted enough to be either a real `vscode-languageserver` `Connection`
 * or a test stub. This keeps the test surface free of stdio plumbing.
 */

import type { ProgressEvent } from '@fugazi/core';

export interface ProgressReporter {
  begin(token: string, title: string): void;
  report(token: string, percentage: number | undefined, message: string | undefined): void;
  end(token: string, message: string | undefined): void;
}

/**
 * Translate a `runAnalysis` ProgressEvent into a workDoneProgress signal. Each
 * `discover.start` opens a new progress block keyed by `token`; the matching
 * `crossref.done` closes it. Phase boundaries between are reported as percent
 * complete (0% at discover.start, 20/40/60/80/100% at downstream phases).
 */
export function makeProgressBridge(
  reporter: ProgressReporter,
  token: string,
  title = 'Fugazi: analyzing project',
): (event: ProgressEvent) => void {
  let begun = false;
  return (event: ProgressEvent): void => {
    switch (event.kind) {
      case 'discover.start':
        if (!begun) {
          reporter.begin(token, title);
          begun = true;
        }
        reporter.report(token, 0, 'Discovering source files');
        return;
      case 'discover.done':
        reporter.report(token, 10, `Discovered ${event.fileCount} files`);
        return;
      case 'extract.start':
        reporter.report(token, 15, `Extracting ${event.total} files`);
        return;
      case 'extract.progress': {
        const pct = event.total > 0 ? 15 + Math.floor((event.n / event.total) * 35) : 15;
        reporter.report(token, pct, `Extracting (${event.n}/${event.total})`);
        return;
      }
      case 'extract.done':
        reporter.report(token, 50, 'Extraction complete');
        return;
      case 'graph.start':
        reporter.report(token, 55, 'Building module graph');
        return;
      case 'graph.done':
        reporter.report(token, 65, `Graph built (${event.edgeCount} edges)`);
        return;
      case 'analyze.start':
        reporter.report(token, 70, `Running ${event.ruleCount} rules`);
        return;
      case 'analyze.progress': {
        const pct = event.total > 0 ? 70 + Math.floor((event.n / event.total) * 25) : 70;
        reporter.report(token, pct, `Rule ${event.rule}`);
        return;
      }
      case 'analyze.done':
        reporter.report(token, 95, 'Analysis complete');
        return;
      case 'crossref.done':
        if (begun) {
          reporter.end(token, 'Done');
          begun = false;
        }
        return;
      case 'runtime.start':
        if (!begun) {
          reporter.begin(token, title);
          begun = true;
        }
        reporter.report(token, 96, 'Runtime intelligence');
        return;
      case 'runtime.done':
        reporter.report(token, 99, 'Runtime intelligence complete');
        return;
      default:
        // Exhaustiveness: every ProgressEvent kind handled above.
        return;
    }
  };
}
