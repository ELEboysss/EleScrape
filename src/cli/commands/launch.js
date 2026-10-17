import path from 'node:path';
import {
  discoverBrowsers,
  getBrowserVersion,
  isDebugPortOpen,
  launchBrowser,
  resolveBrowser,
  waitForDebugPort,
} from '../../core/browser.js';
import { makeLogger } from '../shared.js';
import { UsageError } from '../../util/args.js';

export const summary = 'Start a browser with the DevTools port open (for --attach flows).';

export const usage = 'elescrape launch [options]';

export const spec = {
  options: {
    port: { type: 'number', alias: 'p', default: 9333, desc: 'DevTools port' },
    url: { type: 'string', alias: 'u', default: 'about:blank', desc: 'page to open' },
    browser: { type: 'string', desc: 'browser executable (default: auto-detect)' },
    profile: { type: 'string', desc: 'profile directory (default: <base-dir>/profiles/browser-<port>)' },
    'base-dir': { type: 'string', default: '.elescrape', desc: 'where the profiles/ folder lives' },
    headless: { type: 'boolean', default: false, desc: 'headless mode' },
    wait: { type: 'boolean', default: false, desc: 'keep this process alive until the browser exits' },
    'list-browsers': { type: 'boolean', default: false, desc: 'print detected browsers and exit' },
    json: { type: 'boolean', default: false, desc: 'machine-readable output' },
    quiet: { type: 'boolean', default: false, desc: 'suppress progress output' },
    verbose: { type: 'boolean', alias: 'v', default: false, desc: 'debug logging' },
  },
  positionals: [],
};

export const examples = [
  'elescrape launch --port 9333 --url http://example.com',
  'elescrape launch --list-browsers',
];

export async function execute(options) {
  const logger = makeLogger(options);

  if (options['list-browsers']) {
    const found = discoverBrowsers();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
    } else if (found.length === 0) {
      logger.warn('no Chromium-family browser found on this machine');
    } else {
      for (const b of found) process.stdout.write(`${b.name}\t${b.path}\n`);
    }
    return found.length === 0 ? 1 : 0;
  }

  if (await isDebugPortOpen(options.port)) {
    throw new UsageError(
      `port ${options.port} is already serving the DevTools endpoint; pick another --port`,
    );
  }

  const resolved = resolveBrowser({ executable: options.browser });
  const profile = options.profile
    ? path.resolve(options.profile)
    : path.resolve(options['base-dir'], 'profiles', `browser-${options.port}`);

  logger.info(`launching ${resolved.name}: ${resolved.path}`);
  logger.info(`profile: ${profile}`);
  logger.info(`port   : ${options.port}`);

  const child = launchBrowser({
    executable: resolved.path,
    port: options.port,
    profileDir: profile,
    url: options.url,
    headless: options.headless,
  });

  await waitForDebugPort(options.port, { timeout: 30_000 });
  const version = await getBrowserVersion(options.port);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          type: 'browser',
          pid: child.pid,
          port: options.port,
          profile,
          executable: resolved.path,
          browser: version?.browser ?? null,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    logger.ok(`DevTools endpoint: http://127.0.0.1:${options.port}`);
    logger.info(`attach with: elescrape capture --attach --port ${options.port}`);
  }

  if (options.wait) {
    await new Promise((resolve) => child.once('exit', resolve));
    logger.info('browser closed');
    return 0;
  }

  // The browser is intentionally left running so that `capture --attach`
  // (possibly in another terminal or script) can connect to it.
  child.unref?.();
  return 0;
}
