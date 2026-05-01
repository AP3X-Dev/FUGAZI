#!/usr/bin/env node
import('../packages/cli/dist/index.js').then(async (m) => {
  const exit = await m.run(process.argv.slice(2));
  process.exit(exit);
});
