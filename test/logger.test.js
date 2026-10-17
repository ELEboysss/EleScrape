import test from 'node:test';
import assert from 'node:assert/strict';

import { createLogger } from '../src/util/logger.js';
import { captureOutput } from './helpers/tmp.js';

test('json mode tags every line with an event discriminator', async () => {
  const logger = createLogger({ json: true, level: 'silent' });
  const { stdout } = await captureOutput(() => {
    logger.record({ id: 1, type: 'XHR', method: 'GET', url: 'http://x/a', status: 200 });
    logger.summary({ requests: 1, bodies: 1, bytes: 10, sessionDir: '/tmp/s' });
  });

  const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'record');
  assert.equal(lines[1].event, 'summary');
});

test('a record keeps its own resource type alongside the envelope', async () => {
  const logger = createLogger({ json: true, level: 'silent' });
  const { stdout } = await captureOutput(() => {
    logger.record({ id: 7, type: 'Document', url: 'http://x/', status: 200 });
  });

  const record = JSON.parse(stdout.trim());
  assert.equal(record.event, 'record');
  assert.equal(record.type, 'Document');
});

test('a record without a resource type still exposes the envelope', async () => {
  const logger = createLogger({ json: true, level: 'silent' });
  const { stdout } = await captureOutput(() => {
    logger.record({ id: 8, url: 'http://x/', status: 500 });
  });

  const record = JSON.parse(stdout.trim());
  assert.equal(record.event, 'record');
  assert.equal(record.type, undefined);
  assert.equal(record.status, 500);
});

test('the summary line does not leak a record type', async () => {
  const logger = createLogger({ json: true, level: 'silent' });
  const { stdout } = await captureOutput(() => {
    logger.summary({ requests: 3, bodies: 2, bytes: 99, failed: 1, sessionDir: '/tmp/s' });
  });

  const summary = JSON.parse(stdout.trim());
  assert.equal(summary.event, 'summary');
  assert.equal(summary.type, undefined);
  assert.equal(summary.failed, 1);
});

test('human mode keeps stdout clean and writes progress to stderr', async () => {
  const logger = createLogger({ level: 'info', color: false });
  const { stdout, stderr } = await captureOutput(() => {
    logger.record({ id: 1, type: 'XHR', method: 'GET', url: 'http://x/a', status: 200 });
  });

  assert.equal(stdout, '');
  assert.match(stderr, /GET/);
  assert.match(stderr, /200/);
  assert.match(stderr, /x\/a/);
});

test('quiet mode suppresses progress output', async () => {
  const logger = createLogger({ level: 'silent', color: false });
  const { stdout, stderr } = await captureOutput(() => {
    logger.info('should not appear');
    logger.record({ id: 1, type: 'XHR', method: 'GET', url: 'http://x/a', status: 200 });
  });

  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
