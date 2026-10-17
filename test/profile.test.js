import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveProfile, removeProfile } from '../src/core/profile.js';
import { tmpDir } from './helpers/tmp.js';

test('an explicit profile path wins and is not ephemeral', () => {
  const dir = path.join(tmpDir(), 'my-profile');
  const resolved = resolveProfile({ profile: dir, baseDir: 'D:\\ignored', name: 's1' });
  assert.equal(resolved.dir, path.resolve(dir));
  assert.equal(resolved.ephemeral, false);
  assert.equal(resolved.mode, 'explicit');
});

test('per-session profiles live under profiles/, not inside the session', () => {
  const base = tmpDir();
  const resolved = resolveProfile({ baseDir: base, name: '20261017-120000-abcd' });
  assert.equal(resolved.dir, path.join(base, 'profiles', '20261017-120000-abcd'));
  assert.equal(resolved.ephemeral, true);
  assert.equal(resolved.mode, 'per-session');
  assert.ok(!resolved.dir.includes(`${path.sep}20261017-120000-abcd${path.sep}profile`));
});

test('reuse mode picks one shared profile', () => {
  const base = tmpDir();
  const resolved = resolveProfile({ baseDir: base, name: 's1', reuse: true });
  assert.equal(resolved.dir, path.join(base, 'profiles', 'default'));
  assert.equal(resolved.ephemeral, false);
  assert.equal(resolved.mode, 'reused');
});

test('reuse mode still honours an explicit path', () => {
  const dir = path.join(tmpDir(), 'explicit');
  const resolved = resolveProfile({ profile: dir, reuse: true });
  assert.equal(resolved.mode, 'explicit');
});

test('the default name keeps the path deterministic', () => {
  const base = tmpDir();
  assert.equal(resolveProfile({ baseDir: base }).dir, path.join(base, 'profiles', 'session'));
});

test('removeProfile deletes a temporary profile directory', () => {
  const dir = path.join(tmpDir(), 'profiles', 's1');
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Cookies'), 'x');

  assert.equal(removeProfile(dir), true);
  assert.equal(fs.existsSync(dir), false);
});

test('removeProfile is a no-op for an empty path and tolerates a missing directory', () => {
  assert.equal(removeProfile(''), false);
  assert.equal(removeProfile(undefined), false);
  assert.equal(removeProfile(path.join(tmpDir(), 'never-existed')), true);
});
