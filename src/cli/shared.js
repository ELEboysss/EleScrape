/**
 * Helpers shared by the CLI commands.
 */
import { createLogger, formatBytes } from '../util/logger.js';
import { UsageError } from '../util/args.js';

export { formatBytes };

/** Build a logger from parsed CLI options. */
export function makeLogger(options = {}) {
  let level = options.quiet ? 'silent' : options.verbose ? 'debug' : 'info';
  if (options.json && level === 'info') level = 'info';
  return createLogger({ level, json: Boolean(options.json) });
}

/** Parse "20mb" / "512kb" / "1048576" into bytes. */
export function parseSize(value, { defaultUnit = 'b' } = {}) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const m = /^\s*([\d.]+)\s*(b|kb|mb|gb|tb)?\s*$/i.exec(String(value));
  if (!m) throw new UsageError(`invalid size "${value}" (try 512kb, 20mb, 1048576)`);
  const n = Number(m[1]);
  const unit = (m[2] || defaultUnit).toLowerCase();
  const factor = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 }[unit];
  return Math.round(n * factor);
}

/** Compile repeated filter strings into RegExps; throws a UsageError on bad input. */
export function compileFilters(patterns = []) {
  return patterns.map((p) => {
    try {
      return new RegExp(p);
    } catch (err) {
      throw new UsageError(`invalid --filter pattern "${p}": ${err.message}`);
    }
  });
}

/** True when a record matches the given filters. */
export function recordMatches(record, { include = [], exclude = [], types = [], status = null }) {
  const url = record.url || '';
  if (include.length && !include.some((re) => re.test(url))) return false;
  if (exclude.some((re) => re.test(url))) return false;
  if (types.length) {
    const t = String(record.type || '').toLowerCase();
    if (!types.map((x) => x.toLowerCase()).includes(t)) return false;
  }
  if (status) {
    const s = Number(record.status);
    if (!matchesStatus(s, status)) return false;
  }
  return true;
}

/** Support "200", "2xx", ">=400", "<300". */
export function matchesStatus(status, spec) {
  if (!Number.isFinite(status)) return false;
  const s = String(spec).trim();
  let m = /^(\d)xx$/i.exec(s);
  if (m) return Math.floor(status / 100) === Number(m[1]);
  m = /^(>=|<=|>|<|=)?\s*(\d{3})$/.exec(s);
  if (m) {
    const op = m[1] || '=';
    const n = Number(m[2]);
    switch (op) {
      case '>=': return status >= n;
      case '<=': return status <= n;
      case '>': return status > n;
      case '<': return status < n;
      default: return status === n;
    }
  }
  m = /^(\d{3})\s*-\s*(\d{3})$/.exec(s);
  if (m) return status >= Number(m[1]) && status <= Number(m[2]);
  return false;
}

/** Render a simple fixed-width table. Cells may be pre-formatted strings. */
export function renderTable(headers, rows, { maxWidth = 90 } = {}) {
  const widths = headers.map((h, i) =>
    Math.min(
      maxWidth,
      Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)),
    ),
  );
  const pad = (cell, i) => {
    const s = String(cell ?? '');
    const w = widths[i];
    return s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s.padEnd(w);
  };
  const lines = [headers.map(pad).join('  ').trimEnd()];
  lines.push(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of rows) lines.push(row.map(pad).join('  ').trimEnd());
  return lines.join('\n');
}

/** Best-effort short path for display. */
export function shortPath(url, max = 80) {
  try {
    const u = new URL(url);
    const s = u.protocol === 'data:' ? url : `${u.host}${u.pathname}${u.search}`;
    return s.length > max ? `${s.slice(0, max)}...` : s;
  } catch {
    return url.length > max ? `${url.slice(0, max)}...` : url;
  }
}
