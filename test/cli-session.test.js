import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { run } from '../src/cli/index.js';
import { Recorder } from '../src/core/recorder.js';
import { Session } from '../src/core/session.js';
import { FakeConnection } from './helpers/fake-connection.js';
import { captureOutput, tmpDir } from './helpers/tmp.js';

async function buildSession() {
  const dir = path.join(tmpDir(), 'sess');
  const session = Session.create({ dir });
  const connection = new FakeConnection({
    r1: { body: Buffer.from('{"rows":[1]}').toString('base64'), base64Encoded: true },
    r2: { body: Buffer.from('not found', 'utf8').toString('base64'), base64Encoded: true },
  });
  const recorder = new Recorder({ session });
  await recorder.bind(connection, { id: 'T1' });

  await recorder.handleEvent(connection, 'T1', 'Network.requestWillBeSent', {
    requestId: 'r1',
    type: 'XHR',
    request: { method: 'POST', url: 'http://site/api/list', headers: {}, postData: 'page=1' },
  });
  await recorder.handleEvent(connection, 'T1', 'Network.responseReceived', {
    requestId: 'r1',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  await recorder.handleEvent(connection, 'T1', 'Network.loadingFinished', { requestId: 'r1' });

  await recorder.handleEvent(connection, 'T1', 'Network.requestWillBeSent', {
    requestId: 'r2',
    type: 'Document',
    request: { method: 'GET', url: 'http://site/missing', headers: {} },
  });
  await recorder.handleEvent(connection, 'T1', 'Network.responseReceived', {
    requestId: 'r2',
    response: { status: 404, statusText: 'Not Found', mimeType: 'text/plain', headers: {} },
  });
  await recorder.handleEvent(connection, 'T1', 'Network.loadingFinished', { requestId: 'r2' });

  await session.close();
  return dir;
}

test('list renders a table for a real session', async () => {
  const dir = await buildSession();
  const { result, stdout } = await captureOutput(() => run(['list', dir]));
  assert.equal(result, 0);
  assert.match(stdout, /\/api\/list/);
  assert.match(stdout, /POST/);
  assert.match(stdout, /2 record\(s\)/);
});

test('list honours status and url filters', async () => {
  const dir = await buildSession();
  const { stdout } = await captureOutput(() => run(['list', dir, '--status', '404']));
  assert.match(stdout, /missing/);
  assert.doesNotMatch(stdout, /api\/list/);

  const byUrl = await captureOutput(() => run(['list', dir, '--filter', '/api/']));
  assert.match(byUrl.stdout, /api\/list/);
  assert.doesNotMatch(byUrl.stdout, /missing/);
});

test('list --format jsonl emits one JSON object per line', async () => {
  const dir = await buildSession();
  const { stdout } = await captureOutput(() => run(['list', dir, '--format', 'jsonl']));
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.method, 'POST');
});

test('show prints headers and the decoded body', async () => {
  const dir = await buildSession();
  const { result, stdout } = await captureOutput(() => run(['show', dir, '--id', '1', '--body']));
  assert.equal(result, 0);
  assert.match(stdout, /── request headers ──/);
  assert.match(stdout, /postData|request body/);
  assert.match(stdout, /page=1/);
  assert.match(stdout, /\{"rows":\[1\]\}/);
});

test('show --json round-trips the record', async () => {
  const dir = await buildSession();
  const { stdout } = await captureOutput(() => run(['show', dir, '--id', '2', '--json']));
  const record = JSON.parse(stdout);
  assert.equal(record.id, 2);
  assert.equal(record.status, 404);
});

test('show fails with exit code 1 for an unknown id', async () => {
  const dir = await buildSession();
  const { result, stderr } = await captureOutput(() => run(['show', dir, '--id', '99']));
  assert.equal(result, 1);
  assert.match(stderr, /no record with id 99/);
});

test('export writes CSV with a header row', async () => {
  const dir = await buildSession();
  const outFile = path.join(tmpDir(), 'out.csv');
  const { result } = await captureOutput(() =>
    run(['export', dir, '--format', 'csv', '--out', outFile]),
  );
  assert.equal(result, 0);
  const csv = fs.readFileSync(outFile, 'utf8');
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^id,time,method,url/);
  assert.match(csv, /http:\/\/site\/api\/list/);
});

test('export --format jsonl prints to stdout by default', async () => {
  const dir = await buildSession();
  const { stdout } = await captureOutput(() => run(['export', dir, '--format', 'jsonl']));
  assert.equal(stdout.trim().split('\n').length, 2);
});

test('export with a filter narrows the output', async () => {
  const dir = await buildSession();
  const { stdout } = await captureOutput(() =>
    run(['export', dir, '--format', 'json', '--filter', '/api/']),
  );
  const records = JSON.parse(stdout);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 1);
});

test('replay --dry-run prints the request without sending it', async () => {
  const dir = await buildSession();
  const { result, stdout } = await captureOutput(() =>
    run(['replay', dir, '--id', '1', '--dry-run', '--set', 'rows=1000']),
  );
  assert.equal(result, 0);
  assert.match(stdout, /POST http:\/\/site\/api\/list/);
  assert.match(stdout, /page=1&rows=1000/);
});

test('a directory that is not a session is rejected', async () => {
  const dir = tmpDir();
  const { result, stderr } = await captureOutput(() => run(['list', dir]));
  assert.equal(result, 1);
  assert.match(stderr, /not a scrape-tool session/);
});
