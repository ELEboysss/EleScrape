/**
 * Redaction of credentials found in recorded form payloads.
 *
 * Recorded traffic often contains a plain-text password in an
 * `application/x-www-form-urlencoded` body. Redaction is on by default so a
 * capture directory can be committed or shared without leaking anything.
 */

/** Field names that are redacted out of the box. */
export const DEFAULT_SENSITIVE_KEYS = [
  'password',
  'passwd',
  'pwd',
  'pass',
  'mm',
  'oldmm',
  'newmm',
  'newpwd',
  'oldpwd',
  'qrmm',
  'secret',
  'captcha',
];

export const REDACTED = '<redacted>';

/**
 * Redact the listed keys in a URL-encoded form body (`a=1&b=2`).
 * Keys are matched case-insensitively, and array-style `key[]=` suffixes are
 * handled too.
 */
export function redactFormData(body, keys = DEFAULT_SENSITIVE_KEYS) {
  if (!body || typeof body !== 'string') return body;
  if (!keys || keys.length === 0) return body;

  const lower = new Set(keys.map((k) => String(k).toLowerCase()));

  return body
    .split('&')
    .map((pair) => {
      if (!pair) return pair;
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const rawKey = pair.slice(0, eq);
      const normalized = rawKey.replace(/\[\]$/, '').toLowerCase();
      if (!lower.has(normalized)) return pair;
      return `${rawKey}=${REDACTED}`;
    })
    .join('&');
}

/**
 * Redact the listed keys in a multi-part / JSON body via a coarse textual
 * substitution. Intentionally conservative: it only rewrites the value that
 * follows `"key":` or `name="key"`.
 */
export function redactMultiPart(body, keys = DEFAULT_SENSITIVE_KEYS) {
  if (!body || typeof body !== 'string' || !keys || keys.length === 0) return body;
  let out = body;
  for (const key of keys) {
    const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`("${escaped}"\\s*:\\s*")[^"]*(")`, 'gi'),
      `$1${REDACTED}$2`,
    );
    out = out.replace(
      new RegExp(`(name="${escaped}"[\\s\\S]*?\\r?\\n\\r?\\n)[\\s\\S]*?(\\r?\\n--)`, 'gi'),
      `$1${REDACTED}$2`,
    );
  }
  return out;
}

/** Redact `Authorization` / `Proxy-Authorization` header values. */
export function redactHeaders(headers, { keepCookies = true } = {}) {
  if (!headers) return headers;
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'authorization' || lower === 'proxy-authorization') {
      out[name] = REDACTED;
    } else if (!keepCookies && lower === 'cookie') {
      out[name] = REDACTED;
    } else {
      out[name] = value;
    }
  }
  return out;
}
