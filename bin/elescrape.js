#!/usr/bin/env node
/**
 * EleScrape CLI entry point.
 */
import { run } from '../src/cli/index.js';

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((err) => {
    process.stderr.write(`elescrape: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });
