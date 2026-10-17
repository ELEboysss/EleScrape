import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  redactFormData,
  redactHeaders,
  redactMultiPart,
} from '../src/util/redact.js';

test('default keys cover the usual credential names', () => {
  for (const key of ['password', 'pwd', 'mm', 'oldmm', 'newmm']) {
    assert.ok(DEFAULT_SENSITIVE_KEYS.includes(key), `missing ${key}`);
  }
});

test('redactFormData rewrites only the listed keys', () => {
  const body = 'yhm=student&mm=secret123&rows=10';
  assert.equal(redactFormData(body), `yhm=student&mm=${REDACTED}&rows=10`);
});

test('redactFormData is case-insensitive and handles array keys', () => {
  assert.equal(redactFormData('Password=abc'), `Password=${REDACTED}`);
  assert.equal(redactFormData('pwd[]=abc&keep=1'), `pwd[]=${REDACTED}&keep=1`);
});

test('redactFormData does not touch keys that merely contain a sensitive name', () => {
  assert.equal(redactFormData('xmm=abc&mmx=def'), 'xmm=abc&mmx=def');
});

test('redactFormData leaves the body alone when no keys match', () => {
  const body = 'a=1&b=2';
  assert.equal(redactFormData(body), body);
});

test('redactFormData tolerates empty input', () => {
  assert.equal(redactFormData(''), '');
  assert.equal(redactFormData(undefined), undefined);
  assert.equal(redactFormData('a=1', []), 'a=1');
});

test('redactMultiPart rewrites JSON-style pairs', () => {
  const json = '{"username":"u","password":"p"}';
  assert.equal(redactMultiPart(json), `{"username":"u","password":"${REDACTED}"}`);
});

test('redactHeaders masks authorization but keeps cookies by default', () => {
  const headers = { Authorization: 'Bearer x', Cookie: 'sid=1', Accept: '*/*' };
  const redacted = redactHeaders(headers);
  assert.equal(redacted.Authorization, REDACTED);
  assert.equal(redacted.Cookie, 'sid=1');
  assert.equal(redacted.Accept, '*/*');
});

test('redactHeaders can mask cookies on request', () => {
  const redacted = redactHeaders({ Cookie: 'sid=1' }, { keepCookies: false });
  assert.equal(redacted.Cookie, REDACTED);
});
