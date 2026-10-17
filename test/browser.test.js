import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  BROWSER_CANDIDATES,
  discoverBrowsers,
  isDebugPortOpen,
  resolveBrowser,
} from '../src/core/browser.js';
import { tmpDir } from './helpers/tmp.js';

test('discoverBrowsers returns a de-duplicated list of existing executables', () => {
  const found = discoverBrowsers();
  assert.ok(Array.isArray(found));
  const seen = new Set();
  for (const entry of found) {
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.path, 'string');
    assert.ok(fs.existsSync(entry.path), `${entry.path} should exist`);
    assert.ok(!seen.has(entry.path), 'duplicate path returned');
    seen.add(entry.path);
  }
});

test('BROWSER_CANDIDATES covers the three major platforms', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.ok(Array.isArray(BROWSER_CANDIDATES[platform]));
    assert.ok(BROWSER_CANDIDATES[platform].length > 0);
  }
});

test('resolveBrowser rejects a missing executable', () => {
  assert.throws(() => resolveBrowser({ executable: path.join(tmpDir(), 'nope.exe') }), /not found/);
});

test('resolveBrowser accepts an explicit executable', () => {
  const dir = tmpDir();
  const fake = path.join(dir, 'my-browser');
  fs.writeFileSync(fake, '');
  const resolved = resolveBrowser({ executable: fake });
  assert.equal(resolved.path, fake);
  assert.equal(resolved.name, 'my-browser');
});

test('isDebugPortOpen is false for a closed port', async () => {
  // 1 is a privileged port that nothing listens on in practice.
  assert.equal(await isDebugPortOpen(1, { timeout: 300 }), false);
});
