/**
 * Capture session storage.
 *
 * Layout of a session directory:
 *
 *   meta.json       parameters, browser info, timestamps, final stats
 *   requests.jsonl  one JSON object per completed request/response pair
 *   bodies/         raw response bytes (.bin) plus decoded text (.txt)
 *   summary.json    written on close, convenient for scripts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import readline from 'node:readline';
import { ToolError } from '../util/errors.js';

export const SESSION_MARKER = 'meta.json';

export function timestampSlug(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

function randomSuffix(len = 4) {
  return crypto.randomBytes(8).toString('hex').slice(0, len);
}

/** Make a filesystem-safe, human-readable fragment from a URL. */
export function slugifyUrl(url, method = 'GET', { max = 80 } = {}) {
  let p = url;
  try {
    const u = new URL(url);
    p = u.pathname + (u.search || '');
  } catch {
    /* keep raw */
  }
  const cleaned = p
    .replace(/^\/+/, '')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${method}_${(cleaned || 'root').slice(0, max)}`;
}

export class Session {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.bodiesDir = path.join(this.dir, 'bodies');
    this.recordsPath = path.join(this.dir, 'requests.jsonl');
    this.metaPath = path.join(this.dir, SESSION_MARKER);
    this.summaryPath = path.join(this.dir, 'summary.json');
    this.meta = null;
    this.stats = { requests: 0, bodies: 0, bytes: 0, failed: 0 };
    this.#stream = null;
    this.#id = 0;
  }

  #stream;
  #id;

  /**
   * Create a session directory.
   * @param {{ dir?: string, baseDir?: string, name?: string, options?: object, force?: boolean }} params
   */
  static create({ dir, baseDir = process.cwd(), name, options = {}, force = false } = {}) {
    const target = dir
      ? path.resolve(dir)
      : path.join(path.resolve(baseDir), name || `${timestampSlug()}-${randomSuffix()}`);

    if (fs.existsSync(target) && !force) {
      const entries = fs.readdirSync(target);
      if (entries.length > 0) {
        throw new ToolError(
          `output directory already exists and is not empty: ${target}\n` +
            'Pass --force to write into it anyway, or choose another --out.',
        );
      }
    }

    fs.mkdirSync(path.join(target, 'bodies'), { recursive: true });

    const session = new Session(target);
    session.meta = {
      tool: 'elescrape',
      session: path.basename(target),
      startedAt: new Date().toISOString(),
      endedAt: null,
      options,
      browser: null,
      stats: null,
    };
    session.#writeMeta();
    session.#stream = createWriteStream(session.recordsPath, { flags: 'a' });
    return session;
  }

  /** Open an existing session directory (read-only). */
  static open(dir) {
    const resolved = path.resolve(dir);
    const metaPath = path.join(resolved, SESSION_MARKER);
    if (!fs.existsSync(metaPath)) {
      throw new ToolError(`not a elescrape session (missing meta.json): ${resolved}`);
    }
    const session = new Session(resolved);
    session.meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return session;
  }

  #writeMeta() {
    fs.writeFileSync(this.metaPath, `${JSON.stringify(this.meta, null, 2)}\n`, 'utf8');
  }

  setBrowser(info) {
    this.meta.browser = info;
    if (fs.existsSync(this.dir)) this.#writeMeta();
  }

  nextId() {
    return ++this.#id;
  }

  /**
   * Persist a response body.
   * @returns {{ file?: string, textFile?: string, bytes: number, truncated: boolean, sha256: string }}
   */
  writeBody(record, buffer, { textual = false, decodeText = null, maxBytes = 0 } = {}) {
    let data = buffer;
    let truncated = false;
    if (maxBytes > 0 && data.length > maxBytes) {
      data = data.subarray(0, maxBytes);
      truncated = true;
    }

    const base = `${String(record.id).padStart(4, '0')}-${slugifyUrl(record.url, record.method)}`;
    const binPath = path.join(this.bodiesDir, `${base}.bin`);
    fs.writeFileSync(binPath, data);

    const out = {
      file: path.relative(this.dir, binPath).split(path.sep).join('/'),
      bytes: data.length,
      truncated,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    };

    if (textual && decodeText) {
      const txtPath = path.join(this.bodiesDir, `${base}.txt`);
      fs.writeFileSync(txtPath, decodeText, 'utf8');
      out.textFile = path.relative(this.dir, txtPath).split(path.sep).join('/');
    }

    this.stats.bodies += 1;
    this.stats.bytes += data.length;
    return out;
  }

  /** Append one record and update counters. */
  writeRecord(record) {
    this.stats.requests += 1;
    if (record.status >= 400) this.stats.failed += 1;
    const line = `${JSON.stringify(record)}\n`;
    return new Promise((resolve, reject) => {
      this.#stream.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Flush, write summary.json and close the record stream. */
  async close(extra = {}) {
    this.meta.endedAt = new Date().toISOString();
    this.meta.stats = { ...this.stats, ...extra };
    this.#writeMeta();

    const summary = {
      session: path.basename(this.dir),
      dir: this.dir,
      startedAt: this.meta.startedAt,
      endedAt: this.meta.endedAt,
      ...this.meta.stats,
      browser: this.meta.browser?.browser ?? null,
      url: this.meta.options?.url ?? null,
    };
    fs.writeFileSync(this.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    if (this.#stream) {
      await new Promise((resolve) => this.#stream.end(resolve));
      this.#stream = null;
    }
    return summary;
  }
}

/** Stream records out of a session directory. */
export async function* iterateRecords(dir) {
  const file = path.join(path.resolve(dir), 'requests.jsonl');
  if (!fs.existsSync(file)) return;
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed);
    } catch {
      /* skip corrupted line */
    }
  }
}

/** Read meta.json (or null). */
export function readSessionMeta(dir) {
  const file = path.join(path.resolve(dir), SESSION_MARKER);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Resolve a user-supplied session reference: either a directory path, or a
 * session name looked up under a base directory.
 */
export function resolveSession(ref, { baseDir = process.cwd() } = {}) {
  if (!ref) throw new ToolError('a session directory is required', 2);

  const candidates = [path.resolve(ref)];
  const underBase = path.resolve(baseDir, ref);
  if (underBase !== candidates[0]) candidates.push(underBase);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, SESSION_MARKER))) return dir;
  }

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      throw new ToolError(`not a elescrape session (missing meta.json): ${dir}`);
    }
  }

  throw new ToolError(`session not found: ${ref} (looked in ${candidates.join(', ')})`);
}

/** Read the raw bytes of a recorded body. */
export function readBodyFile(sessionDir, relativePath) {
  return fs.readFileSync(path.join(path.resolve(sessionDir), relativePath));
}
