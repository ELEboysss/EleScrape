import fs from 'node:fs';
import path from 'node:path';
import { iterateRecords, readSessionMeta, resolveSession } from '../../core/session.js';
import { formatBytes } from '../shared.js';
import { UsageError } from '../../util/args.js';

export const summary = 'Print one recorded request/response in full.';

export const usage = 'elescrape show <session> --id <n> [--body] [--json]';

export const spec = {
  options: {
    id: { type: 'number', required: true, desc: 'record id (see `list`)' },
    body: { type: 'boolean', default: false, desc: 'print the decoded response body' },
    raw: { type: 'boolean', default: false, desc: 'print the raw body file bytes' },
    json: { type: 'boolean', default: false, desc: 'print the whole record as JSON' },
    'base-dir': { type: 'string', default: '.scrape', desc: 'where to look for session names' },
  },
  positionals: [{ name: 'session', required: true }],
};

export const examples = [
  'elescrape show <dir> --id 12',
  'elescrape show <dir> --id 12 --body',
  'elescrape show <dir> --id 12 --json',
];

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

  if (options.json) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return 0;
  }

  const meta = readSessionMeta(dir) ?? {};
  const out = [];
  out.push(`${record.method} ${record.url}`);
  out.push(`status   : ${record.status ?? record.error ?? '(none)'} ${record.statusText ?? ''}`.trimEnd());
  out.push(`type     : ${record.type ?? ''}   mime: ${record.mimeType ?? ''}`);
  out.push(`time     : ${record.time}   duration: ${record.durationMs ?? '?'}ms`);
  out.push(`from     : ${record.documentURL ?? '(unknown page)'}`);
  if (record.body) {
    out.push(
      `body     : ${formatBytes(record.body.bytes)}` +
        (record.body.truncated ? ' (truncated)' : '') +
        (record.body.file ? `  -> ${record.body.file}` : '') +
        (record.body.charset ? `  [${record.body.charset}]` : ''),
    );
  } else if (record.bodyError) {
    out.push(`body     : unavailable (${record.bodyError})`);
  } else {
    out.push('body     : not captured');
  }

  out.push('');
  out.push('── request headers ──');
  for (const [k, v] of Object.entries(record.requestHeaders ?? {})) out.push(`  ${k}: ${v}`);
  if (record.postData) {
    out.push('');
    out.push('── request body ──');
    out.push(record.postData);
  }
  out.push('');
  out.push('── response headers ──');
  for (const [k, v] of Object.entries(record.responseHeaders ?? {})) out.push(`  ${k}: ${v}`);

  if (options.body || options.raw) {
    const rel = options.raw ? record.body?.file : record.body?.textFile ?? record.body?.file;
    if (!rel) {
      out.push('');
      out.push('(no body file)');
    } else {
      const full = path.join(dir, rel);
      if (!fs.existsSync(full)) {
        out.push('');
        out.push(`(body file missing: ${rel})`);
      } else {
        const content = fs.readFileSync(full);
        out.push('');
        out.push(`── body (${rel}) ──`);
        process.stdout.write(`${out.join('\n')}\n`);
        process.stdout.write(options.raw ? content : content.toString('utf8'));
        process.stdout.write('\n');
        return 0;
      }
    }
  }

  process.stdout.write(`${out.join('\n')}\n`);
  if (meta.browser) process.stderr.write(`\n(session captured with ${meta.browser})\n`);
  return 0;
}
