import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { Recorder } from '../src/core/recorder.js';
import { Session, iterateRecords } from '../src/core/session.js';
import { FakeConnection } from './helpers/fake-connection.js';
import { tmpDir } from './helpers/tmp.js';

function makeSession() {
  return Session.create({ dir: path.join(tmpDir(), 'sess') });
}

async function collect(dir) {
  const out = [];
  for await (const r of iterateRecords(dir)) out.push(r);
  return out;
}

function request(id, overrides = {}) {
  return {
    requestId: id,
    type: 'XHR',
    documentURL: 'http://site/page',
    request: {
      method: 'POST',
      url: 'http://site/api/list',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      postData: 'page=1&rows=10',
      ...overrides.request,
    },
    ...overrides,
  };
}

function response(id, overrides = {}) {
  return {
    requestId: id,
    response: {
      status: 200,
      statusText: 'OK',
      mimeType: 'application/json',
      headers: { 'content-type': 'application/json;charset=utf-8' },
      ...overrides.response,
    },
    ...overrides,
  };
}

async function recordOne({ recorder, connection, targetId = 'T1', body = '{"rows":[]}' }) {
  await recorder.bind(connection, { id: targetId });
  await recorder.handleEvent(connection, targetId, 'Network.requestWillBeSent', request('r1'));
  await recorder.handleEvent(connection, targetId, 'Network.responseReceived', response('r1'));
  await recorder.handleEvent(connection, targetId, 'Network.loadingFinished', { requestId: 'r1' });
}

test('records a request/response pair with a decoded body', async () => {
  const session = makeSession();
  const connection = new FakeConnection({ r1: '{"rows":[1,2]}' });
  const recorder = new Recorder({ session });

  await recordOne({ recorder, connection, body: '{"rows":[1,2]}' });
  await session.close();

  const [record] = await collect(session.dir);
  assert.equal(record.id, 1);
  assert.equal(record.method, 'POST');
  assert.equal(record.url, 'http://site/api/list');
  assert.equal(record.status, 200);
  assert.equal(record.mimeType, 'application/json');
  assert.equal(record.documentURL, 'http://site/page');
  assert.equal(record.postData, 'page=1&rows=10');
  assert.equal(record.body.bytes, 14);
  assert.equal(record.body.textFile, 'bodies/0001-POST_api_list.txt');
  assert.ok(record.durationMs >= 0);
  assert.equal(
    fs.readFileSync(path.join(session.dir, record.body.textFile), 'utf8'),
    '{"rows":[1,2]}',
  );
});

test('redacts credential form fields by default', async () => {
  const session = makeSession();
  const connection = new FakeConnection({ r1: 'ok' });
  const recorder = new Recorder({ session });

  await recorder.bind(connection, { id: 'T1' });
  await recorder.handleEvent(
    connection,
    'T1',
    'Network.requestWillBeSent',
    request('r1', { request: { postData: 'user=bob&mm=hunter2&keep=1' } }),
  );
  await recorder.handleEvent(connection, 'T1', 'Network.responseReceived', response('r1'));
  await recorder.handleEvent(connection, 'T1', 'Network.loadingFinished', { requestId: 'r1' });
  await session.close();

  const [record] = await collect(session.dir);
  assert.match(record.postData, /mm=<redacted>/);
  assert.doesNotMatch(record.postData, /hunter2/);
});

test('redaction can be turned off', async () => {
  const session = makeSession();
  const connection = new FakeConnection({ r1: 'ok' });
  const recorder = new Recorder({ session, options: { redact: false } });

  await recorder.bind(connection, { id: 'T1' });
  await recorder.handleEvent(
    connection,
    'T1',
    'Network.requestWillBeSent',
    request('r1', { request: { postData: 'mm=hunter2' } }),
  );
  await recorder.handleEvent(connection, 'T1', 'Network.responseReceived', response('r1'));
  await recorder.handleEvent(connection, 'T1', 'Network.loadingFinished', { requestId: 'r1' });
  await session.close();

  const [record] = await collect(session.dir);
  assert.equal(record.postData, 'mm=hunter2');
});

test('exclude filters skip matching requests', async () => {
  const session = makeSession();
  const connection = new FakeConnection();
  const recorder = new Recorder({ session, options: { exclude: ['\\.css$'] } });

  await recorder.bind(connection, { id: 'T1' });
  await recorder.handleEvent(
    connection,
    'T1',
    'Network.requestWillBeSent',
    request('css1', { request: { method: 'GET', url: 'http://site/a.css' } }),
  );
  await session.close();

  assert.deepEqual(await collect(session.dir), []);
  assert.equal(recorder.stats.skipped, 1);
});

test('include filters keep only matching requests', async () => {
  const session = makeSession();
  const connection = new FakeConnection({ r1: 'ok' });
  const recorder = new Recorder({ session, options: { include: ['/api/'] } });

  await recorder.bind(connection, { id: 'T1' });
  await recorder.handleEvent(
    connection,
    'T1',
    'Network.requestWillBeSent',
    request('other', { request: { method: 'GET', url: 'http://site/index.html' } }),
  );
  await recorder.handleEvent(connection, 'T1', 'Network.requestWillBeSent', request('r1'));
  await recorder.handleEvent(connection, 'T1', 'Network.responseReceived', response('r1'));
  await recorder.handleEvent(connection, 'T1', 'Network.loadingFinished', { requestId: 'r1' });
  await session.close();

  const records = await collect(session.dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].url, 'http://site/api/list');
});

test('resource type filters are honoured', async () => {
  const session = makeSession();
  const connection = new FakeConnection();
  const recorder = new Recorder({ session, options: { types: ['XHR'] } });

  await recorder.bind(connection, { id: 'T1' });
  await recorder.handleEvent(
    connection,
    'T1',
    'Network.requestWillBeSent',
    request('doc', { type: 'Document', request: { method: 'GET', url: 'http://site/' } }),
  );
  await session.close();

  assert.deepEqual(await collect(session.dir), []);
});

test('failed requests are still recorded with an error', async () => {
  const session = makeSession();
  const connection = new FakeConnection();
  const recorder = new Recorder({ session });

  await recorder.bind(connection, { id: 'T1' });
  await recorder.handleEvent(connection, 'T1', 'Network.requestWillBeSent', request('r1'));
  await recorder.handleEvent(connection, 'T1', 'Network.loadingFailed', {
    requestId: 'r1',
    errorText: 'net::ERR_ABORTED',
  });
  await session.close();

  const [record] = await collect(session.dir);
  assert.equal(record.error, 'net::ERR_ABORTED');
  assert.equal(record.body, null);
  assert.equal(recorder.stats.failed, 1);
});

test('a missing body is reported without losing the record', async () => {
  const session = makeSession();
  const connection = new FakeConnection({}); // getResponseBody will throw
  const recorder = new Recorder({ session });

  await recordOne({ recorder, connection });
  await session.close();

  const [record] = await collect(session.dir);
  assert.match(record.bodyError, /No resource with given identifier/);
  assert.equal(record.body, null);
});

test('bodies can be disabled entirely', async () => {
  const session = makeSession();
  const connection = new FakeConnection({ r1: 'ok' });
  const recorder = new Recorder({ session, options: { captureBodies: false } });

  await recordOne({ recorder, connection });
  await session.close();

  const [record] = await collect(session.dir);
  assert.equal(record.body, null);
  assert.equal(connection.sent.filter((c) => c.method === 'Network.getResponseBody').length, 0);
});

test('the record event fires for each completed request', async () => {
  const session = makeSession();
  const connection = new FakeConnection({ r1: 'ok' });
  const recorder = new Recorder({ session });
  const seen = [];
  recorder.on('record', (r) => seen.push(r));

  await recordOne({ recorder, connection });
  await session.close();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://site/api/list');
});

test('data: URLs are ignored by default', async () => {
  const session = makeSession();
  const connection = new FakeConnection();
  const recorder = new Recorder({ session });

  await recorder.bind(connection, { id: 'T1' });
  await recorder.handleEvent(
    connection,
    'T1',
    'Network.requestWillBeSent',
    request('d1', {
      type: 'Image',
      request: { method: 'GET', url: 'data:image/png;base64,AAAA' },
    }),
  );
  await session.close();

  assert.deepEqual(await collect(session.dir), []);
});
