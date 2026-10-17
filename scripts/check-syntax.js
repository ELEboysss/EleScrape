#!/usr/bin/env node
/**
 * Load-check: dynamically import every module under src/ to catch syntax and
 * import errors without running the test suite.
 *
 * Spawning `node --check` per file would be simpler but needs one child
 * process per file, which some restricted environments block outright.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const files = walk(path.join(ROOT, 'src'));

let failed = 0;
for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
  } catch (err) {
    failed += 1;
    console.error(`✖ ${path.relative(ROOT, file)}`);
    console.error(`  ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} module(s) failed to load`);
  process.exit(1);
}
console.log(`✔ ${files.length} module(s) loaded cleanly`);
