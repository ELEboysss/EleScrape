/**
 * scrape-tool — public library entry point.
 *
 * Everything exported here is dependency-free and usable from plain Node.
 * The CLI is a thin wrapper around these same primitives.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const version = pkg.version;

export { capture } from './capture.js';

export {
  Session,
  iterateRecords,
  readSessionMeta,
  readBodyFile,
  resolveSession,
  slugifyUrl,
  SESSION_MARKER,
} from './core/session.js';

export { Recorder } from './core/recorder.js';
export { TargetWatcher } from './core/targets.js';
export { CdpConnection, CdpError } from './core/cdp.js';

export {
  discoverBrowsers,
  resolveBrowser,
  launchBrowser,
  closeBrowser,
  isDebugPortOpen,
  waitForDebugPort,
  listTargets,
  getBrowserVersion,
} from './core/browser.js';

export { createLogger, formatBytes } from './util/logger.js';
export { decodeBuffer, charsetFromContentType, isTextual } from './util/charset.js';
export {
  redactFormData,
  redactHeaders,
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
} from './util/redact.js';
