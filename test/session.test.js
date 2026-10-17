import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  Session,
  iterateRecords,
  readSessionMeta,
  resolveSession,
  slugifyUrl,
} from '../src/core/session.js';
import { tmpDir } from './helpers/tmp.js';

test('slugifyUrl produces a filesystem-safe fragment', () => {
  assert.equal(slugifyUrl('http://a.b/common/query?id=1', 'POST'), 'POST_common_query_id_1');
  assert.equal(slugifyUrl('http://a.b/', 'GET'), 'GET_root');
  assert.ok(!slugifyUrl('http://a.b/a b/c?d=e#f', 'GET').includes(' '));
});

test('Session.create writes meta.json and a bodies directory', async () => {
  const dir = path.join(tmpDir(), 'sess');
  const session = Session.create({ dir, options: { url: 'http://x' } });
  assert.ok(fs.existsSync(path.join(dir, 'meta.json')));
  assert.ok(fs.existsSync(path.join(dir, 'bodies')));

  const meta = readSessionMeta(dir);
  assert.equal(meta.options.url, 'http://x');
  assert.equal(meta.tool, 'elescrape');
  await session.close({ stopReason: 'test' });
  assert.ok(fs.existsSync(path.join(dir, 'summary.json')));
});

test('Session refuses to reuse a non-empty directory without force', () => {
  const dir = path.join(tmpDir(), 'sess');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
  assert.throws(() => Session.create({ dir }), /already exists and is not empty/);
  assert.doesNotThrow(() => Session.create({ dir, force: true }));
});

test('bodies and records round-trip through disk', async () => {
  const dir = path.join(tmpDir(), 'sess');
  const session = Session.create({ dir });

  const record = { id: session.nextId(), method: 'GET', url: 'http://x/a', status: 200 };
  const body = session.writeBody(record, Buffer.from('hello'), {
    textual: true,
    decodeText: 'hello',
  });
  record.body = body;
  await session.writeRecord(record);
  const summary = await session.close();

  assert.equal(summary.requests, 1);
  assert.equal(summary.bodies, 1);
  assert.equal(summary.bytes, 5);

  const saved = [];
  for await (const r of iterateRecords(dir)) saved.push(r);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].body.bytes, 5);
  assert.equal(saved[0].body.textFile, 'bodies/0001-GET_a.txt');
  assert.equal(
    fs.readFileSync(path.join(dir, saved[0].body.textFile), 'utf8'),
    'hello',
  );
});

test('writeBody truncates above the byte cap and records a hash', async () => {
  const dir = path.join(tmpDir(), 'sess');
  const session = Session.create({ dir });
  const record = { id: session.nextId(), method: 'GET', url: 'http://x/big' };
  const body = session.writeBody(record, Buffer.alloc(100, 0x61), { maxBytes: 10 });
  assert.equal(body.bytes, 10);
  assert.equal(body.truncated, true);
  assert.match(body.sha256, /^[0-9a-f]{64}$/);
  await session.close();
});

test('resolveSession accepts a path or a name under the base directory', () => {
  const base = tmpDir();
  const dir = path.join(base, 'named');
  const session = Session.create({ dir });
  return session.close().then(() => {
    assert.equal(resolveSession(dir), path.resolve(dir));
    assert.equal(resolveSession('named', { baseDir: base }), path.resolve(dir));
    assert.throws(() => resolveSession('missing', { baseDir: base }), /session not found/);
  });
});
