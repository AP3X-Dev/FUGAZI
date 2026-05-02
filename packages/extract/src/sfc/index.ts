/**
 * sfc/index.ts — Phase 3c.5 — public surface for SFC handlers.
 *
 * Each handler accepts a single SFC source string and returns the same
 * `Inventory` shape produced by `buildInventory()` for plain `.ts` / `.tsx`
 * files. Position fields point into the SFC source directly (byte-offset,
 * line, and column are all SFC-source-relative).
 */

export { parseVueSFC } from './vue.js';
export {
  type BlockLanguage,
  type ScriptBlock,
  type StyleBlock,
  type TemplateBlock,
  extractScriptBlocks,
  extractStyleBlocks,
  extractTemplateBlock,
  maskNonBlock,
} from './extract-blocks.js';
