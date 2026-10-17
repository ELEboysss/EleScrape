import test from 'node:test';
import assert from 'node:assert/strict';

import {
  charsetFromContentType,
  decodeBuffer,
  isTextual,
  looksBinary,
} from '../src/util/charset.js';

// "导师" encoded as GBK (导 = B5BC, 师 = CAA6)
const GBK_DAOSHI = Buffer.from([0xb5, 0xbc, 0xca, 0xa6]);

test('charsetFromContentType reads the declared charset', () => {
  assert.equal(charsetFromContentType('text/html; charset=GBK'), 'gbk');
  assert.equal(charsetFromContentType('application/json;charset="utf-8"'), 'utf-8');
  assert.equal(charsetFromContentType('text/plain'), null);
  assert.equal(charsetFromContentType(undefined), null);
});

test('decodeBuffer honours utf-8 by default', () => {
  const { text, charset } = decodeBuffer(Buffer.from('你好', 'utf8'), 'text/html');
  assert.equal(text, '你好');
  assert.equal(charset, 'utf-8');
});

test('decodeBuffer falls back to gbk for undeclared Chinese bytes', () => {
  const { text, charset } = decodeBuffer(GBK_DAOSHI, 'text/html');
  assert.equal(text, '导师');
  assert.equal(charset, 'gbk');
});

test('decodeBuffer respects an explicitly declared gbk charset', () => {
  const { text, charset } = decodeBuffer(GBK_DAOSHI, 'text/html; charset=gb2312');
  assert.equal(text, '导师');
  assert.equal(charset, 'gb2312');
});

test('decodeBuffer keeps valid utf-8 even when gbk would also decode', () => {
  const { text } = decodeBuffer(Buffer.from('中文', 'utf8'), 'application/json');
  assert.equal(text, '中文');
});

test('looksBinary detects NUL bytes', () => {
  assert.equal(looksBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), true);
  assert.equal(looksBinary(Buffer.from('plain text')), false);
});

test('isTextual classifies by mime and resource type', () => {
  const buf = Buffer.from('{"a":1}');
  assert.equal(isTextual(buf, { mimeType: 'application/json' }), true);
  assert.equal(isTextual(buf, { resourceType: 'XHR' }), true);
  assert.equal(isTextual(buf, { mimeType: 'image/png' }), false);
  assert.equal(isTextual(Buffer.alloc(0), { mimeType: 'text/html' }), false);
});
