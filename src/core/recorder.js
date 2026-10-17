/**
 * Recorder — turns raw CDP network events into session records.
 *
 * The recorder is deliberately free of browser lifecycle concerns: it is bound
 * to one `CdpConnection` at a time and only needs `Network.getResponseBody`,
 * which makes it straightforward to unit test with a fake connection.
 */
import { EventEmitter } from 'node:events';
import { decodeBuffer, isTextual } from '../util/charset.js';
import { DEFAULT_SENSITIVE_KEYS, redactFormData, redactHeaders } from '../util/redact.js';

const REDIRECTABLE = new Set([301, 302, 303, 307, 308]);

export class Recorder extends EventEmitter {
  /**
   * @param {object} params
   * @param {import('./session.js').Session} params.session
   * @param {object} [params.options]
   */
  constructor({ session, options = {} }) {
    super();
    this.session = session;
    this.options = {
      include: [],
      exclude: [],
      types: [],
      captureBodies: true,
      maxBodyBytes: 20 * 1024 * 1024,
      redact: true,
      redactKeys: DEFAULT_SENSITIVE_KEYS,
      keepCookies: true,
      includeDataUrls: false,
      ...options,
    };

    this.#include = this.options.include.map(toRegExp);
    this.#exclude = this.options.exclude.map(toRegExp);
    this.#types = new Set(this.options.types.map((t) => String(t).toLowerCase()));
    this.stats = { seen: 0, recorded: 0, skipped: 0, failed: 0 };
  }

  #include = [];
  #exclude = [];
  #types = new Set();
  #inflight = new Map();
  #bindings = new WeakMap();
  #bindCount = 0;

  /** Bind a connection and start recording. Resolves once Network is enabled. */
  async bind(connection, target = {}) {
    const targetKey = target.id || `conn-${++this.#bindCount}`;
    this.#bindings.set(connection, targetKey);

    connection.on('event', (method, params) => {
      this.handleEvent(connection, targetKey, method, params).catch((err) => {
        this.emit('error', err);
      });
    });

    await connection.send('Network.enable');
    await connection.send('Page.enable');
    return targetKey;
  }

  /** Filter check for a URL/resource type pair. */
  matches(url, resourceType) {
    if (!this.options.includeDataUrls && url.startsWith('data:')) return false;

    const type = String(resourceType || '').toLowerCase();
    if (this.#types.size > 0 && !this.#types.has(type)) return false;

    if (this.#include.length > 0) {
      const ok = this.#include.some((re) => re.test(url));
      if (!ok) return false;
    }
    if (this.#exclude.some((re) => re.test(url))) return false;

    return true;
  }

  /** Handle one CDP event. Exposed for tests. */
  async handleEvent(connection, targetKey, method, params) {
    const key = `${targetKey}:${params?.requestId ?? ''}`;

    switch (method) {
      case 'Network.requestWillBeSent': {
        const request = params.request || {};
        const url = request.url || '';

        if (!this.matches(url, params.type)) {
          this.stats.skipped += 1;
          this.#inflight.delete(key);
          return;
        }
        this.stats.seen += 1;

        const record = {
          id: this.session.nextId(),
          time: new Date().toISOString(),
          method: request.method || 'GET',
          url,
          type: params.type || 'Other',
          documentURL: params.documentURL || null,
          requestHeaders: this.options.redact
            ? redactHeaders(request.headers, { keepCookies: this.options.keepCookies })
            : request.headers,
          postData: this.options.redact
            ? redactFormData(request.postData, this.options.redactKeys)
            : request.postData,
          status: null,
          durationMs: null,
          body: null,
        };
        this.#inflight.set(key, { record, startedAt: Date.now(), redirected: false });
        return;
      }

      case 'Network.responseReceived': {
        const entry = this.#inflight.get(key);
        if (!entry) return;
        const response = params.response || {};
        entry.record.status = response.status ?? null;
        entry.record.statusText = response.statusText ?? '';
        entry.record.mimeType = response.mimeType ?? '';
        entry.record.fromCache = Boolean(response.fromDiskCache || response.fromPrefetchCache);
        entry.record.responseHeaders = response.headers ?? {};
        entry.record.remoteIPAddress = response.remoteIPAddress ?? null;
        if (REDIRECTABLE.has(response.status)) entry.redirected = true;
        return;
      }

      case 'Network.loadingFinished': {
        const entry = this.#inflight.get(key);
        if (!entry) return;
        this.#inflight.delete(key);
        entry.record.durationMs = Date.now() - entry.startedAt;
        await this.#finalize(connection, entry.record, params.requestId);
        return;
      }

      case 'Network.loadingFailed': {
        const entry = this.#inflight.get(key);
        if (!entry) return;
        this.#inflight.delete(key);
        entry.record.durationMs = Date.now() - entry.startedAt;
        entry.record.error = params.errorText || 'request failed';
        entry.record.canceled = Boolean(params.canceled);
        this.stats.failed += 1;
        await this.#persist(entry.record);
        return;
      }

      default:
    }
  }

  async #finalize(connection, record, requestId) {
    if (this.options.captureBodies) {
      try {
        const result = await connection.send('Network.getResponseBody', { requestId });
        const buffer = Buffer.from(result.body ?? '', result.base64Encoded ? 'base64' : 'utf8');
        const h = record.responseHeaders || {};
        const contentType = h['content-type'] || h['Content-Type'] || '';
        const textual = isTextual(buffer, {
          mimeType: record.mimeType,
          contentType,
          resourceType: record.type,
        });
        const decoded = textual ? decodeBuffer(buffer, contentType || record.mimeType) : null;

        record.body = this.session.writeBody(record, buffer, {
          textual,
          decodeText: decoded?.text ?? null,
          maxBytes: this.options.maxBodyBytes,
        });
        if (decoded?.charset && decoded.charset !== 'utf-8') record.body.charset = decoded.charset;
      } catch (err) {
        record.bodyError = err?.message ?? String(err);
      }
    }

    await this.#persist(record);
  }

  async #persist(record) {
    this.stats.recorded += 1;
    await this.session.writeRecord(record);
    this.emit('record', record);
  }

  /** Number of requests currently awaiting a response. */
  get pendingCount() {
    return this.#inflight.size;
  }
}

function toRegExp(value) {
  if (value instanceof RegExp) return value;
  try {
    return new RegExp(String(value));
  } catch (err) {
    throw new Error(`invalid filter pattern "${value}": ${err.message}`);
  }
}
