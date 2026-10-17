import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { capture } from '../src/capture.js';
import { iterateRecords, readSessionMeta } from '../src/core/session.js';
import { startFakeBrowser } from './helpers/fake-browser.js';
import { tmpDir } from './helpers/tmp.js';

async function readAll(dir) {
  const records = [];
  for await (const record of iterateRecords(dir)) records.push(record);
  return records;
}

test('capture() records traffic from a fake DevTools endpoint', async () => {
  const fake = await startFakeBrowser({ responses: { r1: '{"rows":[1,2,3]}' } });
  const dir = path.join(tmpDir(), 'sess');

  try {
    const result = await capture({
      port: fake.port,
      out: dir,
      attach: true,
      duration: 3,
      level: 'silent',
    });

    assert.equal(result.stopReason, 'duration');
    assert.equal(result.summary.requests, 2);
    assert.equal(result.summary.bodies, 1);
    assert.equal(result.summary.failed, 1); // the 404

    const records = await readAll(dir);
    assert.equal(records.length, 2);

    const api = records.find((r) => r.url === 'http://fake/api/one');
    assert.equal(api.method, 'POST');
    assert.equal(api.status, 200);
    assert.equal(api.type, 'XHR');
    assert.equal(api.postData, 'page=1&rows=10');
    assert.equal(api.documentURL, 'http://fake/page');
    assert.ok(api.body.bytes > 0);
    assert.equal(api.body.textFile, 'bodies/0001-POST_api_one.txt');

    const page = records.find((r) => r.url === 'http://fake/page');
    assert.equal(page.status, 404);
    assert.ok(page.bodyError, 'expected bodyError for an unregistered body');

    const meta = readSessionMeta(dir);
    assert.equal(meta.browser.mode, 'attach');
    assert.match(meta.browser.browser, /FakeChrome/);

    assert.equal(fake.connections >= 1, true);
  } finally {
    await fake.close();
  }
});

test('capture() applies include filters end-to-end', async () => {
  const fake = await startFakeBrowser();
  const dir = path.join(tmpDir(), 'sess');

  try {
    const result = await capture({
      port: fake.port,
      out: dir,
      attach: true,
      duration: 3,
      include: ['/api/'],
      level: 'silent',
    });

    assert.equal(result.summary.requests, 1);
    const records = await readAll(dir);
    assert.equal(records.length, 1);
    assert.equal(records[0].url, 'http://fake/api/one');
  } finally {
    await fake.close();
  }
});

test('capture() honours an AbortSignal', async () => {
  const fake = await startFakeBrowser();
  const dir = path.join(tmpDir(), 'sess');
  const controller = new AbortController();

  try {
    setTimeout(() => controller.abort(), 700);
    const result = await capture({
      port: fake.port,
      out: dir,
      attach: true,
      signal: controller.signal,
      level: 'silent',
    });
    assert.equal(result.stopReason, 'aborted');
  } finally {
    await fake.close();
  }
});
