import path from 'node:path';
import { capture } from '../../capture.js';
import { compileFilters, makeLogger, parseSize } from '../shared.js';

export const summary = 'Record browser traffic into a session directory.';

export const usage = 'elescrape capture --url <url> [options]';

export const spec = {
  options: {
    url: { type: 'string', alias: 'u', default: 'about:blank', desc: 'page to open and capture' },
    port: { type: 'number', alias: 'p', default: 9333, desc: 'DevTools port' },
    out: { type: 'string', alias: 'o', desc: 'session directory (default: <base-dir>/<timestamp>)' },
    'base-dir': { type: 'string', default: '.scrape', desc: 'parent directory for auto-named sessions' },
    browser: { type: 'string', desc: 'browser executable (default: auto-detect)' },
    profile: { type: 'string', desc: 'browser profile directory (default: <session>/profile)' },
    attach: { type: 'boolean', default: false, desc: 'never spawn; wait for an external browser' },
    headless: { type: 'boolean', default: false, desc: 'headless mode (launch only)' },
    navigate: { type: 'boolean', default: true, desc: 'open --url after attaching (--no-navigate to skip)' },
    filter: { type: 'string', multiple: true, desc: 'only record URLs matching this regex (repeatable)' },
    exclude: { type: 'string', multiple: true, desc: 'skip URLs matching this regex (repeatable)' },
    type: { type: 'string', multiple: true, desc: 'only record these resource types (XHR, Fetch, Document, ...)' },
    bodies: { type: 'boolean', default: true, desc: 'capture response bodies (--no-bodies to skip)' },
    'max-body': { type: 'string', default: '20mb', desc: 'per-body size cap, e.g. 512kb or 20mb' },
    redact: { type: 'boolean', default: true, desc: 'redact credential form fields (--no-redact to keep)' },
    duration: { type: 'number', default: 0, desc: 'stop after N seconds (0 = no limit)' },
    idle: { type: 'number', default: 0, desc: 'stop after N seconds without traffic (0 = off)' },
    'attach-timeout': { type: 'number', default: 300, desc: 'seconds to wait for an external browser' },
    json: { type: 'boolean', default: false, desc: 'emit NDJSON records on stdout' },
    quiet: { type: 'boolean', default: false, desc: 'suppress progress output' },
    verbose: { type: 'boolean', alias: 'v', default: false, desc: 'debug logging' },
    force: { type: 'boolean', default: false, desc: 'write into a non-empty --out directory' },
  },
  positionals: [],
};

export const examples = [
  'elescrape capture --url http://example.com',
  'elescrape capture --url http://example.com --filter "/api/" --duration 30 --json',
  'elescrape capture --attach --port 9222 --url http://example.com',
];

export async function execute(options) {
  const logger = makeLogger(options);

  const result = await capture({
    url: options.url,
    port: options.port,
    out: options.out ? path.resolve(options.out) : undefined,
    baseDir: path.resolve(options['base-dir']),
    browser: options.browser,
    profile: options.profile,
    attach: options.attach,
    headless: options.headless,
    navigate: options.navigate,
    include: compileFilters(options.filter),
    exclude: compileFilters(options.exclude),
    types: options.type ?? [],
    bodies: options.bodies,
    maxBodyBytes: parseSize(options['max-body']),
    redact: options.redact,
    duration: options.duration,
    idle: options.idle,
    attachTimeout: options['attach-timeout'],
    json: options.json,
    level: options.quiet ? 'silent' : options.verbose ? 'debug' : 'info',
    logger,
    force: options.force,
  });

  if (!options.json) {
    logger.info('');
    logger.info(`inspect : elescrape list "${result.dir}"`);
    logger.info(`show    : elescrape show "${result.dir}" --id <n>`);
    logger.info(`export  : elescrape export "${result.dir}" --format jsonl --out out.jsonl`);
  }

  return 0;
}
