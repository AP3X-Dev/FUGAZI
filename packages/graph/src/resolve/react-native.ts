/**
 * react-native.ts — T087 / T088 — React Native platform-extension probing.
 *
 * React Native (and Expo) projects probe platform-specific extensions before
 * the plain `.ts` / `.tsx` candidates. For an importer running on iOS:
 *
 *     ./Button -> Button.ios.tsx -> Button.ios.ts -> Button.ios.js
 *               -> Button.tsx     -> Button.ts     -> Button.js
 *
 * The platform list is configurable. The default `['ios', 'android']` covers
 * the two RN production platforms; `web` is added by Expo for web bundles.
 *
 * This module never reads `package.json` or walks `node_modules` — those are
 * the responsibilities of the bare-specifier resolver. It only re-probes the
 * already-resolved relative target with platform suffixes layered on top.
 */
import type { FsAdapter } from './fs-adapter.js';
import { dirnamePosix, joinPosix } from './path-utils.js';
import { RELATIVE_EXTENSIONS } from './relative.js';

/**
 * Default platform priority for vanilla React Native.
 *
 * Frozen for determinism — the order is part of the contract; tests depend on
 * `ios` taking precedence over `android` when both are available.
 */
export const DEFAULT_RN_PLATFORMS: readonly string[] = Object.freeze(['ios', 'android', 'native']);

const RN_SOURCE_EXTS: readonly string[] = Object.freeze(['.ts', '.tsx', '.js', '.jsx']);

function probeWithPlatform(base: string, platform: string, fs: FsAdapter): string | null {
  for (const ext of RN_SOURCE_EXTS) {
    const probe = `${base}.${platform}${ext}`;
    if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
  }
  return null;
}

/**
 * Resolve a relative specifier with platform-extension awareness. Returns
 * the platform-specific file path when one exists, the plain file path when
 * platform variants are absent but a vanilla file exists, or `null`.
 *
 * @param specifier  A relative specifier (`.` / `..` prefix).
 * @param fromFile   POSIX path of the importing file.
 * @param platforms  Active platform list, in priority order. Defaults to
 *                   `DEFAULT_RN_PLATFORMS`.
 * @param fs         Filesystem adapter.
 */
export function resolveReactNative(
  specifier: string,
  fromFile: string,
  platforms: readonly string[] | undefined,
  fs: FsAdapter,
): string | null {
  if (!(specifier.startsWith('./') || specifier.startsWith('../'))) return null;
  const fromDir = dirnamePosix(fromFile);
  const base = joinPosix(fromDir, specifier);
  const active = platforms ?? DEFAULT_RN_PLATFORMS;

  // Strip a known extension from `base` before applying the platform suffix.
  // `Button.tsx` becomes `Button.ios.tsx` (we replace, not append).
  const baseStem = stripKnownExtension(base);

  // 1. Platform-specific probes in priority order.
  for (const platform of active) {
    const hit = probeWithPlatform(baseStem, platform, fs);
    if (hit !== null) return hit;
  }

  // 2. Vanilla probe with the standard extension list.
  for (const ext of RELATIVE_EXTENSIONS) {
    if (baseStem.endsWith(ext)) {
      // Already extension-bearing. Ignore unless it points at a file.
      return fs.existsSync(baseStem) && !fs.isDirectorySync(baseStem) ? baseStem : null;
    }
    const probe = `${baseStem}${ext}`;
    if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
  }

  // 3. Directory index probe with platform extensions, then plain.
  if (fs.isDirectorySync(baseStem)) {
    for (const platform of active) {
      const idx = joinPosix(baseStem, 'index');
      const hit = probeWithPlatform(idx, platform, fs);
      if (hit !== null) return hit;
    }
    for (const ext of RELATIVE_EXTENSIONS) {
      const probe = joinPosix(baseStem, `index${ext}`);
      if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
    }
  }
  return null;
}

function stripKnownExtension(p: string): string {
  for (const ext of RN_SOURCE_EXTS) {
    if (p.endsWith(ext)) return p.slice(0, -ext.length);
  }
  return p;
}
