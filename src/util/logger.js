/**
 * Logging.
 *
 * Two channels, always separated so that scripts can pipe stdout safely:
 *   - stdout: machine readable. In `--json` mode every record is one NDJSON
 *     line; otherwise stdout stays quiet and only the final summary is printed.
 *   - stderr: human progress, warnings and errors.
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

const COLORS = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
};

function statusColor(status) {
  if (!status) return 'dim';
  if (status >= 500) return 'red';
  if (status >= 400) return 'yellow';
  if (status >= 300) return 'cyan';
  return 'green';
}

function time() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function shortUrl(url, max = 110) {
  try {
    const u = new URL(url);
    const path = u.pathname + (u.search || '');
    const s = u.host && u.protocol !== 'data:' ? `${u.host}${path}` : url;
    return s.length > max ? `${s.slice(0, max)}...` : s;
  } catch {
    return url.length > max ? `${url.slice(0, max)}...` : url;
  }
}

export function createLogger({ level = 'info', json = false, color = undefined } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const useColor = color ?? (process.stderr.isTTY === true && !process.env.NO_COLOR);

  const paint = (name, text) => (useColor ? `${COLORS[name]}${text}${COLORS.reset}` : text);

  const writeErr = (prefix, msg) => {
    if (!useColor) {
      process.stderr.write(`${time()} ${prefix}${msg}\n`);
      return;
    }
    process.stderr.write(`${paint('dim', time())} ${prefix}${msg}\n`);
  };

  return {
    level,
    json,

    debug(msg) {
      if (threshold >= LEVELS.debug) writeErr(paint('dim', 'DBG '), msg);
    },
    info(msg) {
      if (threshold >= LEVELS.info) writeErr('', msg);
    },
    warn(msg) {
      if (threshold >= LEVELS.warn) writeErr(paint('yellow', 'WARN '), msg);
    },
    error(msg) {
      if (threshold >= LEVELS.error) writeErr(paint('red', 'ERR '), msg);
    },
    ok(msg) {
      if (threshold >= LEVELS.info) writeErr(paint('green', 'OK   '), msg);
    },

    /** Emit one completed record. */
    record(rec) {
      if (json) {
        // `event` rather than `type`: a record carries its own `type`
        // (the resource type), which would otherwise overwrite the envelope.
        process.stdout.write(`${JSON.stringify({ event: 'record', ...rec })}\n`);
        return;
      }
      if (threshold < LEVELS.info) return;
      const status = String(rec.status ?? '---').padStart(3);
      const bytes = String(rec.body?.bytes ?? 0).padStart(7);
      const type = String(rec.type ?? '').padEnd(10);
      const line = `${paint(statusColor(rec.status), status)} ${String(rec.method).padEnd(4)} ${paint('dim', type)} ${bytes}B  ${shortUrl(rec.url)}`;
      process.stderr.write(`${paint('dim', time())} ${line}\n`);
    },

    /** Emit the final summary object. */
    summary(obj) {
      if (json) {
        process.stdout.write(`${JSON.stringify({ event: 'summary', ...obj })}\n`);
        return;
      }
      if (threshold < LEVELS.info) return;
      const parts = [
        `${obj.requests ?? 0} requests`,
        `${obj.bodies ?? 0} bodies`,
        `${formatBytes(obj.bytes ?? 0)}`,
      ];
      if (obj.failed) parts.push(`${obj.failed} failed`);
      process.stderr.write(`${paint('dim', time())} ${paint('blue', 'DONE')} ${parts.join(' · ')}\n`);
      if (obj.sessionDir) process.stderr.write(`${paint('dim', time())}      ${obj.sessionDir}\n`);
    },
  };
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const __internal = { LEVELS, statusColor, shortUrl };
