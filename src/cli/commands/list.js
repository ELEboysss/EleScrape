import { iterateRecords, resolveSession } from '../../core/session.js';
import { compileFilters, formatBytes, recordMatches, renderTable, shortPath } from '../shared.js';

export const summary = 'List the requests recorded in a session.';

export const usage = 'elescrape list <session> [options]';

export const spec = {
  options: {
    filter: { type: 'string', multiple: true, desc: 'only URLs matching this regex' },
    exclude: { type: 'string', multiple: true, desc: 'skip URLs matching this regex' },
    type: { type: 'string', multiple: true, desc: 'only these resource types' },
    status: { type: 'string', desc: 'status filter: 200, 2xx, ">=400", 300-399' },
    format: { type: 'string', default: 'table', choices: ['table', 'json', 'jsonl'], desc: 'output format' },
    limit: { type: 'number', default: 0, desc: 'stop after N matching records (0 = all)' },
    'base-dir': { type: 'string', default: '.elescrape', desc: 'where to look for session names' },
  },
  positionals: [{ name: 'session', required: true }],
};

export const examples = [
  'elescrape list .elescrape/20260101-120000-abcd',
  'elescrape list <dir> --filter "/api/" --status 2xx',
  'elescrape list <dir> --format jsonl',
];

export async function execute(options, positionals) {
  const dir = resolveSession(positionals[0], { baseDir: options['base-dir'] });
  const include = compileFilters(options.filter);
  const exclude = compileFilters(options.exclude);
  const types = options.type ?? [];

  const matched = [];
  for await (const record of iterateRecords(dir)) {
    if (!recordMatches(record, { include, exclude, types, status: options.status })) continue;
    matched.push(record);
    if (options.limit && matched.length >= options.limit) break;
  }

  if (options.format === 'jsonl') {
    for (const r of matched) process.stdout.write(`${JSON.stringify(r)}\n`);
    return 0;
  }
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(matched, null, 2)}\n`);
    return 0;
  }

  if (matched.length === 0) {
    process.stderr.write('no matching records\n');
    return 0;
  }

  const rows = matched.map((r) => [
    r.id,
    String(r.status ?? (r.error ? 'ERR' : '---')),
    r.method,
    r.type ?? '',
    formatBytes(r.body?.bytes ?? 0),
    r.durationMs != null ? `${r.durationMs}ms` : '',
    shortPath(r.url),
  ]);

  process.stdout.write(
    `${renderTable(['ID', 'STATUS', 'METHOD', 'TYPE', 'SIZE', 'TIME', 'URL'], rows)}\n`,
  );
  process.stdout.write(`\n${matched.length} record(s) in ${dir}\n`);
  return 0;
}
