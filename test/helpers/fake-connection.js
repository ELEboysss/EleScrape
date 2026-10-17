import { EventEmitter } from 'node:events';

/**
 * A stand-in for `CdpConnection` used by the recorder tests.
 * Records every command sent and answers `Network.getResponseBody` from a map.
 */
export class FakeConnection extends EventEmitter {
  constructor(bodies = {}) {
    super();
    this.bodies = bodies;
    this.sent = [];
    this.closed = false;
  }

  async send(method, params = {}) {
    this.sent.push({ method, params });
    if (method === 'Network.getResponseBody') {
      const entry = this.bodies[params.requestId];
      if (entry === undefined) {
        throw new Error('No resource with given identifier found');
      }
      return typeof entry === 'string' ? { body: entry, base64Encoded: false } : entry;
    }
    return {};
  }

  close() {
    this.closed = true;
    this.emit('close');
  }

  /** Deliver a protocol event as the real client would. */
  emitCdp(method, params) {
    this.emit('event', method, params);
  }
}
