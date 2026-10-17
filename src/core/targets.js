/**
 * TargetWatcher — discovers browser tabs and keeps a CDP connection to each.
 *
 * Polling `/json/list` (rather than Target.setAutoAttach) keeps this simple and
 * robust across Chromium versions: every new tab, including SSO popups and
 * windows opened by the page itself, is picked up on the next poll.
 */
import { EventEmitter } from 'node:events';
import { CdpConnection } from './cdp.js';
import { listTargets } from './browser.js';

export class TargetWatcher extends EventEmitter {
  #timer = null;
  #attached = new Map();

  constructor({ port, interval = 1000, logger = null, ignorePrivate = true } = {}) {
    super();
    this.port = port;
    this.interval = interval;
    this.logger = logger;
    this.ignorePrivate = ignorePrivate;
    this.running = false;
    this.emptyPolls = 0;
  }

  get connections() {
    return [...this.#attached.values()];
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), this.interval);
    this.#timer.unref?.();
  }

  async stop() {
    this.running = false;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const { connection } of this.#attached.values()) {
      try {
        connection.close();
      } catch {
        /* ignore */
      }
    }
    this.#attached.clear();
  }

  async #tick() {
    if (!this.running) return;

    let targets;
    try {
      targets = await listTargets(this.port);
    } catch (err) {
      this.emptyPolls += 1;
      if (this.listenerCount('error') > 0) this.emit('error', err);
      if (this.emptyPolls >= 3) this.emit('gone');
      return;
    }

    const pages = targets.filter(
      (t) =>
        t.type === 'page' &&
        typeof t.webSocketDebuggerUrl === 'string' &&
        t.webSocketDebuggerUrl.length > 0 &&
        !String(t.url).startsWith('devtools://'),
    );

    this.emptyPolls = pages.length === 0 ? this.emptyPolls + 1 : 0;
    if (pages.length === 0 && this.emptyPolls >= 3) {
      this.emit('gone');
      return;
    }

    const seen = new Set(pages.map((p) => p.id));

    for (const target of pages) {
      if (this.#attached.has(target.id)) continue;
      try {
        const connection = await CdpConnection.connect(target.webSocketDebuggerUrl, {
          label: target.id,
        });
        this.#attached.set(target.id, { connection, target });

        connection.on('close', () => {
          this.#attached.delete(target.id);
          this.emit('detach', target);
        });

        this.logger?.debug(`attached to target ${target.id} (${target.url})`);
        this.emit('attach', connection, target);
      } catch (err) {
        if (this.listenerCount('error') > 0) this.emit('error', err);
      }
    }

    // Drop targets that disappeared without a clean close event.
    for (const [id, entry] of this.#attached) {
      if (!seen.has(id)) {
        try {
          entry.connection.close();
        } catch {
          /* ignore */
        }
        this.#attached.delete(id);
        this.emit('detach', entry.target);
      }
    }
  }
}
