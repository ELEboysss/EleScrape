import test from 'node:test';
import assert from 'node:assert/strict';

import { run } from '../src/cli/index.js';
import { version } from '../src/index.js';
import { captureOutput } from './helpers/tmp.js';

test('prints the version', async () => {
  const { result, stdout } = await captureOutput(() => run(['--version']));
  assert.equal(result, 0);
  assert.equal(stdout.trim(), version);
});

test('prints general help', async () => {
  const { result, stdout } = await captureOutput(() => run(['--help']));
  assert.equal(result, 0);
  for (const command of ['capture', 'launch', 'list', 'show', 'export', 'replay']) {
    assert.match(stdout, new RegExp(command));
  }
});

test('help with no arguments prints general help', async () => {
  const { result, stdout } = await captureOutput(() => run([]));
  assert.equal(result, 0);
  assert.match(stdout, /Usage:/);
});

test('help <command> prints command help', async () => {
  const { result, stdout } = await captureOutput(() => run(['help', 'capture']));
  assert.equal(result, 0);
  assert.match(stdout, /--url/);
  assert.match(stdout, /--attach/);
});

test('<command> --help works too', async () => {
  const { result, stdout } = await captureOutput(() => run(['export', '--help']));
  assert.equal(result, 0);
  assert.match(stdout, /--format/);
});

test('an unknown command exits 2', async () => {
  const { result, stderr } = await captureOutput(() => run(['bogus']));
  assert.equal(result, 2);
  assert.match(stderr, /unknown command/);
});

test('a missing required argument exits 2', async () => {
  const { result, stderr } = await captureOutput(() => run(['list']));
  assert.equal(result, 2);
  assert.match(stderr, /missing required argument/);
});

test('an unknown option exits 2', async () => {
  const { result, stderr } = await captureOutput(() => run(['list', 'x', '--nope']));
  assert.equal(result, 2);
  assert.match(stderr, /unknown option/);
});

test('aliases resolve to their commands', async () => {
  const { result, stderr } = await captureOutput(() => run(['ls']));
  assert.equal(result, 2);
  assert.match(stderr, /missing required argument/);
});
