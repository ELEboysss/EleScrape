#!/usr/bin/env node
/**
 * A tiny demo site so you can try EleScrape without touching a real server.
 *
 *   node examples/demo-server.js
 *   node bin/elescrape.js capture --url http://127.0.0.1:8089/ --filter "/api/"
 *
 * Endpoints:
 *   GET  /              login page (form posts to /api/login)
 *   POST /api/login     accepts any credentials, sets a session cookie
 *   POST /api/users     jqGrid-style paged JSON: { page, total, records, rows }
 *   GET  /api/slow      delayed response, useful for `--idle` / `--duration`
 *   GET  /assets/*      static CSS/JS noise
 */
import http from 'node:http';

const PORT = Number(process.env.DEMO_PORT || 8089);
const PAGE_SIZE = 10;

const DEPARTMENTS = ['Engineering', 'Design', 'Research', 'Operations', 'Finance'];
const USERS = Array.from({ length: 37 }, (_, i) => ({
  id: 1000 + i,
  name: `Person ${String(i + 1).padStart(2, '0')}`,
  dept: DEPARTMENTS[i % DEPARTMENTS.length],
  email: `person${i + 1}@example.test`,
  score: (i * 17) % 100,
}));

const CSS = Array.from({ length: 200 }, (_, i) => `.c${i}{margin:${i}px}`).join('\n');
const JS = `console.log('demo app loaded');\n${'// filler line\n'.repeat(200)}`;

const LOGIN_PAGE = `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <title>EleScrape demo</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <h1>EleScrape demo</h1>
  <form id="login">
    <label>user <input name="username" value="demo"></label>
    <label>pass <input name="password" type="password" value="demo-pass"></label>
    <button type="submit">Log in</button>
  </form>
  <pre id="out"></pre>
  <script src="/assets/app.js"></script>
  <script>
    document.getElementById('login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = new URLSearchParams(new FormData(e.target));
      const res = await fetch('/api/login', { method: 'POST', body });
      document.getElementById('out').textContent = await res.text();
      const page = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ page: '1', rows: '${PAGE_SIZE}' }),
      });
      document.getElementById('out').textContent += '\\n' + (await page.text()).slice(0, 400);
    });
  </script>
</body>
</html>`;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === '/' || path === '/index') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(LOGIN_PAGE);
    return;
  }

  if (path === '/assets/app.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    res.end(CSS);
    return;
  }

  if (path === '/assets/app.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(JS);
    return;
  }

  if (path === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    res.setHeader('set-cookie', `demo_session=${Date.now()}; Path=/; HttpOnly`);
    sendJson(res, 200, { ok: true, echo: body.length, note: 'any credentials accepted' });
    return;
  }

  if (path === '/api/users' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const page = Math.max(1, Number(params.get('page') || 1));
    const rows = Math.max(1, Number(params.get('rows') || PAGE_SIZE));
    const start = (page - 1) * rows;
    const slice = USERS.slice(start, start + rows);
    sendJson(res, 200, {
      page,
      total: Math.ceil(USERS.length / rows),
      records: USERS.length,
      rows: slice,
    });
    return;
  }

  if (path === '/api/slow') {
    const ms = Math.min(10_000, Number(url.searchParams.get('ms') || 2000));
    setTimeout(() => sendJson(res, 200, { waited: ms }), ms);
    return;
  }

  sendJson(res, 404, { error: 'not found', path });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`demo server: http://127.0.0.1:${PORT}/\n`);
  process.stdout.write(`try: node bin/elescrape.js capture --url http://127.0.0.1:${PORT}/ --filter "/api/"\n`);
});
