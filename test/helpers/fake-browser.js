/**
 * A fake DevTools endpoint: an HTTP server that speaks just enough of the
 * Chrome DevTools Protocol (including the WebSocket handshake) for
 * `capture()` to run end-to-end without a browser.
 *
 * This is what makes the transport layer testable in CI, where installing and
 * launching Chromium is not practical.
 */
import crypto from 'node:crypto';
import http from 'node:http';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ---- WebSocket framing ----------------------------------------------------

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN + text frame
  return Buffer.concat([header, payload]);
}

/** Parse one masked client frame. Returns { opcode, payload, size } or null. */
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;

  const mask = masked ? buf.subarray(offset, offset + 4) : null;
  const data = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
  if (mask) {
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  }

  return { opcode, payload: data.toString('utf8'), size: offset + maskLen + len };
}

// ---- server ---------------------------------------------------------------

/**
 * @param {object} [params]
 * @param {object} [params.responses]  map of requestId -> response body
 * @param {number} [params.settleMs]   delay before scripted traffic is emitted
 * @returns {Promise<{ port: number, connections: number, close: Function }>}
 */
export async function startFakeBrowser({ responses = {}, settleMs = 120 } = {}) {
  const sockets = new Set();
  let connections = 0;
  let port = 0;

  const targetId = 'FAKE-1';
  const target = () => ({
    id: targetId,
    type: 'page',
    title: 'fake page',
    url: 'about:blank',
    description: '',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${targetId}`,
  });

  const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      const body = JSON.stringify({
        Browser: 'FakeChrome/1.0',
        'Protocol-Version': '1.3',
        'User-Agent': 'fake',
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    if (req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([target()]));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));

    const send = (obj) => {
      if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(obj)));
    };
    const reply = (id, result = {}) => send({ id, result });

    let buffer = Buffer.alloc(0);
    let scripted = false;

    const emit = (method, params) => send({ method, params });

    const runScript = () => {
      if (scripted) return;
      scripted = true;

      const steps = [
        () =>
          emit('Network.requestWillBeSent', {
            requestId: 'r1',
            type: 'XHR',
            documentURL: 'http://fake/page',
            request: {
              method: 'POST',
              url: 'http://fake/api/one',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              postData: 'page=1&rows=10',
            },
          }),
        () =>
          emit('Network.responseReceived', {
            requestId: 'r1',
            response: {
              status: 200,
              statusText: 'OK',
              mimeType: 'application/json',
              headers: { 'content-type': 'application/json; charset=utf-8' },
            },
          }),
        () => emit('Network.loadingFinished', { requestId: 'r1' }),
        () =>
          emit('Network.requestWillBeSent', {
            requestId: 'r2',
            type: 'Document',
            documentURL: 'http://fake/page',
            request: { method: 'GET', url: 'http://fake/page', headers: {} },
          }),
        () =>
          emit('Network.responseReceived', {
            requestId: 'r2',
            response: {
              status: 404,
              statusText: 'Not Found',
              mimeType: 'text/html',
              headers: { 'content-type': 'text/html; charset=utf-8' },
            },
          }),
        () => emit('Network.loadingFinished', { requestId: 'r2' }),
      ];

      steps.forEach((step, i) => setTimeout(step, settleMs + i * 40));
    };

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const frame = decodeFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.size);

        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode !== 0x1) continue;

        let msg;
        try {
          msg = JSON.parse(frame.payload);
        } catch {
          continue;
        }
        if (msg.id === undefined) continue;

        switch (msg.method) {
          case 'Network.getResponseBody': {
            const key = msg.params?.requestId;
            const body = responses[key];
            if (body === undefined) {
              send({ id: msg.id, error: { code: -32000, message: 'No resource with given identifier found' } });
            } else {
              reply(msg.id, { body: Buffer.from(body, 'utf8').toString('base64'), base64Encoded: true });
            }
            break;
          }
          case 'Network.enable':
            reply(msg.id, {});
            setTimeout(runScript, settleMs);
            break;
          default:
            reply(msg.id, {});
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  return {
    port,
    get connections() {
      return connections;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
