#!/usr/bin/env node
import('../dist/index.js').then(async (m) => {
  const exit = await m.run(process.argv.slice(2));
  process.exit(exit);
});
