import test from 'node:test';
import assert from 'node:assert/strict';

import { UsageError, formatOptions, parseArgs } from '../src/util/args.js';

const spec = {
  options: {
    url: { type: 'string', alias: 'u' },
    port: { type: 'number', alias: 'p', default: 9333 },
    attach: { type: 'boolean', default: false },
    filter: { type: 'string', multiple: true },
    format: { type: 'string', choices: ['json', 'csv'] },
    id: { type: 'number', required: true },
  },
  positionals: [{ name: 'session', required: false }],
};

test('parses long options with a space', () => {
  const { options } = parseArgs(['--url', 'http://x', '--id', '3'], spec);
  assert.equal(options.url, 'http://x');
  assert.equal(options.id, 3);
});

test('parses --key=value', () => {
  const { options } = parseArgs(['--url=http://y', '--id=7'], spec);
  assert.equal(options.url, 'http://y');
  assert.equal(options.id, 7);
});

test('parses short aliases including attached values', () => {
  const { options } = parseArgs(['-u', 'http://z', '-p8080', '--id', '1'], spec);
  assert.equal(options.url, 'http://z');
  assert.equal(options.port, 8080);
});

test('applies defaults', () => {
  const { options } = parseArgs(['--id', '1'], spec);
  assert.equal(options.port, 9333);
  assert.equal(options.attach, false);
});

test('supports boolean flags and --no- negation', () => {
  assert.equal(parseArgs(['--attach', '--id', '1'], spec).options.attach, true);
  assert.equal(parseArgs(['--no-attach', '--id', '1'], spec).options.attach, false);
});

test('collects repeatable options into an array', () => {
  const { options } = parseArgs(['--filter', 'a', '--filter', 'b', '--id', '1'], spec);
  assert.deepEqual(options.filter, ['a', 'b']);
});

test('rejects unknown options', () => {
  assert.throws(() => parseArgs(['--nope'], spec), UsageError);
});

test('rejects a missing value', () => {
  assert.throws(() => parseArgs(['--url'], spec), /requires a value/);
});

test('rejects a non-numeric value for a number option', () => {
  assert.throws(() => parseArgs(['--id', 'abc'], spec), /expected a number/);
});

test('enforces required options', () => {
  assert.throws(() => parseArgs([], spec), /missing required option --id/);
});

test('enforces choices', () => {
  assert.throws(() => parseArgs(['--id', '1', '--format', 'xml'], spec), /invalid value/);
});

test('collects positionals and honours --', () => {
  assert.deepEqual(parseArgs(['--id', '1', 'sess'], spec).positionals, ['sess']);
  assert.deepEqual(parseArgs(['--id', '1', '--', '--weird'], spec).positionals, ['--weird']);
});

test('rejects extra positionals', () => {
  assert.throws(() => parseArgs(['--id', '1', 'a', 'b'], spec), /unexpected argument/);
});

test('formatOptions renders usage and flags', () => {
  const text = formatOptions({ usage: 'tool x [opts]', options: spec.options });
  assert.match(text, /Usage:/);
  assert.match(text, /--url/);
  assert.match(text, /-p, --port/);
});
