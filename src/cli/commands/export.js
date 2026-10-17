import fs from 'node:fs';
import path from 'node:path';
import { iterateRecords, resolveSession } from '../../core/session.js';
import { compileFilters, recordMatches } from '../shared.js';
import { UsageError } from '../../util/args.js';

export const summary = 'Export recorded requests to JSON, JSONL or CSV.';

export const usage = 'scrape-tool export <session> --format jsonl|csv|json [--out file]';

export const spec = {
  options: {
    format: { type: 'string', default: 'jsonl', choices: ['jsonl', 'json', 'csv'], desc: 'output format' },
    out: { type: 'string', alias: 'o', default: '-', desc: 'output file, or - for stdout' },
    filter: { type: 'string', multiple: true, desc: 'only URLs matching this regex' },
    exclude: { type: 'string', multiple: true, desc: 'skip URLs matching this regex' },
    type: { type: 'string', multiple: true, desc: 'only these resource types' },
    status: { type: 'string', desc: 'status filter: 200, 2xx, ">=400"' },
    fields: { type: 'string', desc: 'comma-separated CSV columns (default: a useful subset)' },
    bom: { type: 'boolean', default: false, desc: 'prefix CSV with a UTF-8 BOM (Excel-friendly)' },
    pretty: { type: 'boolean', default: false, desc: 'pretty-print --format json' },
    'base-dir': { type: 'string', default: '.scrape', desc: 'where to look for session names' },
  },
  positionals: [{ name: 'session', required: true }],
};

export const examples = [
  'scrape-tool export <dir> --format csv --out requests.csv',
  'scrape-tool export <dir> --filter "/api/" --format jsonl',
  'scrape-tool export <dir> --format csv --fields id,method,url,status,body.textFile',
];

const DEFAULT_CSV_FIELDS = [
  'id',
  'time',
  'method',
  'url',
  'type',
  'status',
  'mimeType',
  'durationMs',
  'body.bytes',
  'postData',
];

function pick(record, dotted) {
  return dotted.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), record);
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function execute(options, positionals) {
  const dir = resolveSession(positionals[0], { baseDir: options['base-dir'] });
  const include = compileFilters(options.filter);
  const exclude = compileFilters(options.exclude);
  const fields = options.fields
    ? options.fields.split(',').map((f) => f.trim()).filter(Boolean)
    : DEFAULT_CSV_FIELDS;

  const records = [];
  for await (const record of iterateRecords(dir)) {
    if (!recordMatches(record, { include, exclude, types: options.type ?? [], status: options.status })) {
      continue;
    }
    records.push(record);
  }

  let payload;
  if (options.format === 'json') {
    payload = JSON.stringify(records, null, options.pretty ? 2 : 0);
    if (options.pretty) payload += '\n';
  } else if (options.format === 'jsonl') {
    payload = records.map((r) => JSON.stringify(r)).join('\n');
    if (payload) payload += '\n';
  } else {
    const lines = [fields.map(csvCell).join(',')];
    for (const r of records) lines.push(fields.map((f) => csvCell(pick(r, f))).join(','));
    payload = `${options.bom ? '\uFEFF' : ''}${lines.join('\r\n')}\r\n`;
  }

  if (!payload) process.stderr.write('no matching records\n');

  if (options.out === '-') {
    process.stdout.write(payload);
  } else {
    const target = path.resolve(options.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, payload, 'utf8');
    process.stderr.write(`wrote ${records.length} record(s) to ${target}\n`);
  }

  return 0;
}
