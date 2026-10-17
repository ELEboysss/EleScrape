import { iterateRecords, resolveSession } from '../../core/session.js';
import { UsageError } from '../../util/args.js';

export const summary = 'Replay one recorded request against the live server.';

export const usage = 'elescrape replay <session> --id <n> [--set key=value] [--dry-run]';

export const spec = {
  options: {
    id: { type: 'number', required: true, desc: 'record id to replay' },
    method: { type: 'string', desc: 'override the HTTP method' },
    set: { type: 'string', multiple: true, desc: 'override a form field, e.g. --set rows=1000' },
    header: { type: 'string', multiple: true, desc: 'add or replace a header, e.g. --header "X-Foo: 1"' },
    'dry-run': { type: 'boolean', default: false, desc: 'print the request instead of sending it' },
    'no-follow': { type: 'boolean', default: false, desc: 'do not follow redirects' },
    'max-output': { type: 'number', default: 2000, desc: 'truncate the response body in the terminal' },
    'base-dir': { type: 'string', default: '.elescrape', desc: 'where to look for session names' },
  },
  positionals: [{ name: 'session', required: true }],
};

export const examples = [
  'elescrape replay <dir> --id 139',
  'elescrape replay <dir> --id 139 --set rows=1000 --set page=1',
  'elescrape replay <dir> --id 139 --dry-run',
];

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'keep-alive',
]);

function applyOverrides(postData, sets) {
  if (!sets || sets.length === 0) return postData;
  const params = new URLSearchParams(postData ?? '');
  for (const pair of sets) {
    const eq = pair.indexOf('=');
    if (eq === -1) throw new UsageError(`--set expects key=value, got "${pair}"`);
    params.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return params.toString();
}

export async function execute(options, positionals) {
  const dir = resolveSession(positionals[0], { baseDir: options['base-dir'] });

  let record = null;
  for await (const r of iterateRecords(dir)) {
    if (r.id === options.id) {
      record = r;
      break;
    }
  }
  if (!record) throw new UsageError(`no record with id ${options.id} in ${dir}`, { exitCode: 1 });

  const method = (options.method || record.method || 'GET').toUpperCase();
  const postData = method === 'GET' || method === 'HEAD'
    ? undefined
    : applyOverrides(record.postData, options.set);

  const headers = {};
  for (const [k, v] of Object.entries(record.requestHeaders ?? {})) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
  }
  for (const raw of options.header ?? []) {
    const idx = raw.indexOf(':');
    if (idx === -1) throw new UsageError(`--header expects "Name: value", got "${raw}"`);
    headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  }
  if (postData !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }

  if (options['dry-run']) {
    process.stdout.write(`${method} ${record.url}\n`);
    for (const [k, v] of Object.entries(headers)) process.stdout.write(`${k}: ${v}\n`);
    if (postData) process.stdout.write(`\n${postData}\n`);
    return 0;
  }

  if (!/^https?:/i.test(record.url)) {
    throw new UsageError(`cannot replay ${record.url} — not an http(s) URL`);
  }

  process.stderr.write(`→ ${method} ${record.url}\n`);
  const response = await fetch(record.url, {
    method,
    headers,
    body: postData,
    redirect: options['no-follow'] ? 'manual' : 'follow',
  });

  const text = await response.text();
  process.stderr.write(`← ${response.status} ${response.statusText}\n`);
  const limit = options['max-output'] > 0 ? options['max-output'] : text.length;
  const shown = text.length > limit ? `${text.slice(0, limit)}\n… (${text.length} bytes total)` : text;
  process.stdout.write(`${shown}\n`);
  return response.ok ? 0 : 0;
}
