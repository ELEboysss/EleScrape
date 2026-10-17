/**
 * Browser profile placement.
 *
 * The profile is Chromium's `--user-data-dir`: it holds cookies, local storage
 * and the login state. Where it lives is a trade-off the caller should be able
 * to choose:
 *
 *   explicit path  — the caller owns the directory and its lifetime
 *   reused         — one shared profile, so a login survives between captures
 *   per-session    — a throw-away profile per capture, so every run starts clean
 *
 * Profiles never live inside the session directory: they are large (hundreds of
 * files) and would drown the actual capture output.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {object} params
 * @param {string} [params.profile]  explicit profile directory
 * @param {string} [params.baseDir]  directory that owns the `profiles/` folder
 * @param {string} [params.name]     per-session profile name (usually the session id)
 * @param {boolean} [params.reuse]   share one persistent profile between captures
 * @returns {{ dir: string, ephemeral: boolean, mode: 'explicit'|'reused'|'per-session' }}
 */
export function resolveProfile({ profile, baseDir = process.cwd(), name, reuse = false } = {}) {
  if (profile) {
    return { dir: path.resolve(profile), ephemeral: false, mode: 'explicit' };
  }
  const root = path.join(path.resolve(baseDir), 'profiles');
  if (reuse) {
    return { dir: path.join(root, 'default'), ephemeral: false, mode: 'reused' };
  }
  return { dir: path.join(root, name || 'session'), ephemeral: true, mode: 'per-session' };
}

/**
 * Best-effort removal of a temporary profile. Chromium may still hold a few
 * file handles just after exiting, so retry briefly before giving up.
 * @returns {boolean} true when the directory is gone
 */
export function removeProfile(dir) {
  if (!dir) return false;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    return !fs.existsSync(dir);
  } catch {
    return false;
  }
}
