/**
 * A minimal Chrome DevTools Protocol client over the built-in WebSocket.
 *
 * One connection == one browser target (tab). Events are re-emitted on the
 * instance, and `send()` resolves with the protocol result.
 */
import { EventEmitter } from 'node:events';

export class CdpError extends Error {
  constructor(message, { method, code } = {}) {
    super(message);
    this.name = 'CdpError';
    this.method = method;
    this.code = code;
  }
}

export class CdpConnection extends EventEmitter {
  #ws;
  #pending = new Map();
  #nextId = 1;

  constructor(ws, { label = '' } = {}) {
    super();
    this.#ws = ws;
    this.label = label;
    this.closed = false;

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }

      if (msg.id && this.#pending.has(msg.id)) {
        const { resolve, reject, method, timer } = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) {
          reject(new CdpError(msg.error.message || 'CDP error', { method, code: msg.error.code }));
        } else {
          resolve(msg.result ?? {});
        }
        return;
      }

      if (msg.method) this.emit('event', msg.method, msg.params ?? {});
    });

    ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject, timer } of this.#pending.values()) {
        clearTimeout(timer);
        reject(new CdpError('connection closed'));
      }
      this.#pending.clear();
      this.emit('close');
    });

    ws.addEventListener('error', (err) => {
      // Never let a socket error become an uncaught exception: only surface it
      // when somebody is actually listening.
      if (this.listenerCount('error') > 0) {
        this.emit('error', err instanceof Error ? err : new Error('websocket error'));
      }
    });
  }

  /** Open a connection and resolve once the socket is ready. */
  static connect(wsUrl, { timeout = 10_000, label = '' } = {}) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(new CdpError(`cannot open websocket: ${err.message}`));
        return;
      }

      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new CdpError(`websocket open timed out after ${timeout}ms`));
      }, timeout);

      const onOpen = () => {
        clearTimeout(timer);
        ws.removeEventListener('error', onError);
        resolve(new CdpConnection(ws, { label }));
      };
      const onError = (err) => {
        clearTimeout(timer);
        reject(new CdpError(`websocket error: ${err?.message ?? 'unknown'}`));
      };

      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });
    });
  }

  /** Send a protocol command and resolve with its result. */
  send(method, params = {}, { timeout = 30_000 } = {}) {
    if (this.closed) return Promise.reject(new CdpError(`connection closed (${method})`, { method }));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError(`CDP command timed out: ${method}`, { method }));
      }, timeout);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, method, timer });
      try {
        this.#ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(new CdpError(`cannot send ${method}: ${err.message}`, { method }));
      }
    });
  }

  close() {
    this.closed = true;
    try {
      this.#ws.close();
    } catch {
      /* ignore */
    }
  }
}
