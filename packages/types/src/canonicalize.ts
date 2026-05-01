/**
 * canonicalize() — async path canonicalization (replaces Rust-era `dunce`).
 *
 * Resolves symlinks via `fs.promises.realpath`, then applies platform-specific
 * normalization so the same logical path always produces the same string:
 *
 *   - Windows: strip the `\\?\` verbatim prefix, convert backslashes to forward
 *     slashes, and uppercase the drive letter.
 *   - macOS: `realpath` already returns the canonical `/private/tmp/...` form;
 *     no special-case is needed.
 *   - All platforms: strip a trailing slash unless the path is a filesystem
 *     root (`/` on POSIX, `<drive>:/` on Windows).
 *
 * Per IMP-MOD-12, no synchronous fs calls are permitted here — the function is
 * always asynchronous.
 */
import { realpath } from 'node:fs/promises';
import { sep } from 'node:path';
import { FugaziError } from './errors/index.js';

export async function canonicalize(p: string): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(p);
  } catch (cause) {
    throw new FugaziError({
      code: 'FS_PATH_NOT_FOUND',
      message: `Path not found: ${p}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  // Windows-specific normalization
  if (process.platform === 'win32') {
    // Strip leading \\?\ verbatim prefix (covers UNC + drive variants)
    if (resolved.startsWith('\\\\?\\')) {
      resolved = resolved.slice(4);
    }
    // Convert backslashes to forward slashes
    resolved = resolved.replaceAll('\\', '/');
    // Uppercase the drive letter (e.g. `c:/foo` → `C:/foo`)
    if (resolved.length >= 2 && resolved[1] === ':') {
      resolved = `${(resolved[0] ?? '').toUpperCase()}${resolved.slice(1)}`;
    }
  }

  // Strip trailing slash unless path is a filesystem root.
  if (resolved.length > 1) {
    const tail = resolved.slice(-1);
    if (tail === '/' || tail === sep) {
      // Allow root '/' (POSIX, len 1 — already excluded above) or '<drive>:/' (Windows after normalization)
      const isWindowsRoot = resolved.length === 3 && resolved[1] === ':';
      if (!isWindowsRoot) {
        resolved = resolved.slice(0, -1);
      }
    }
  }

  return resolved;
}
