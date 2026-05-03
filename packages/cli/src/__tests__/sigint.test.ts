/**
 * sigint.test.ts — Phase 3h.6 (T205) — two-step SIGINT handler.
 */
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { FIRST_CTRL_C_MESSAGE, installSigintHandler } from '../watch/sigint.js';

function makeStderr(): { stream: NodeJS.WritableStream; getOutput(): string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, getOutput: () => buf };
}

describe('installSigintHandler', () => {
  it('first SIGINT prints verbatim message and calls onAbort', () => {
    const stderr = makeStderr();
    const onAbort = vi.fn();
    const onSecond = vi.fn();
    const handle = installSigintHandler({
      stderr: stderr.stream,
      onAbort,
      onSecondInterrupt: onSecond,
    });
    try {
      process.emit('SIGINT');
      expect(stderr.getOutput()).toBe(FIRST_CTRL_C_MESSAGE);
      expect(onAbort).toHaveBeenCalledTimes(1);
      expect(onSecond).not.toHaveBeenCalled();
      expect(handle.armed).toBe(true);
    } finally {
      handle.detach();
    }
  });

  it('FIRST_CTRL_C_MESSAGE matches the verbatim contract', () => {
    expect(FIRST_CTRL_C_MESSAGE).toBe(
      'Cancelled in-flight analysis. Press Ctrl-C again to exit.\n',
    );
  });

  it('second SIGINT within window triggers onSecondInterrupt', () => {
    const stderr = makeStderr();
    const onAbort = vi.fn();
    const onSecond = vi.fn();
    const handle = installSigintHandler({
      stderr: stderr.stream,
      onAbort,
      onSecondInterrupt: onSecond,
      windowMs: 2000,
    });
    try {
      process.emit('SIGINT');
      process.emit('SIGINT');
      expect(onSecond).toHaveBeenCalledTimes(1);
    } finally {
      handle.detach();
    }
  });

  it('second SIGINT after window resets — does NOT trigger exit', async () => {
    vi.useFakeTimers();
    const stderr = makeStderr();
    const onAbort = vi.fn();
    const onSecond = vi.fn();
    const handle = installSigintHandler({
      stderr: stderr.stream,
      onAbort,
      onSecondInterrupt: onSecond,
      windowMs: 100,
    });
    try {
      process.emit('SIGINT');
      await vi.advanceTimersByTimeAsync(150);
      process.emit('SIGINT');
      expect(onSecond).not.toHaveBeenCalled();
      expect(onAbort).toHaveBeenCalledTimes(2);
    } finally {
      handle.detach();
      vi.useRealTimers();
    }
  });

  it('detach removes the listener', () => {
    const stderr = makeStderr();
    const onAbort = vi.fn();
    const onSecond = vi.fn();
    // Install a no-op fallback listener so emitting SIGINT after detach
    // doesn't actually terminate the process if vitest isn't capturing it.
    const fallback = (): void => {};
    process.on('SIGINT', fallback);
    try {
      const handle = installSigintHandler({
        stderr: stderr.stream,
        onAbort,
        onSecondInterrupt: onSecond,
      });
      handle.detach();
      process.emit('SIGINT');
      expect(onAbort).not.toHaveBeenCalled();
      expect(onSecond).not.toHaveBeenCalled();
    } finally {
      process.removeListener('SIGINT', fallback);
    }
  });
});
