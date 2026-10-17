/**
 * High-level capture orchestration.
 *
 * `capture()` resolves when the capture ends: the browser window is closed, a
 * `--duration` / `--idle` limit fires, an AbortSignal is raised, or Ctrl+C.
 * Everything it does is also reachable from the smaller building blocks in
 * `src/core`, so this module is a convenience layer, not the only entry point.
 */
import path from 'node:path';
import { Session } from './core/session.js';
import { Recorder } from './core/recorder.js';
import { TargetWatcher } from './core/targets.js';
import {
  closeBrowser,
  getBrowserVersion,
  isDebugPortOpen,
  launchBrowser,
  resolveBrowser,
  sleep,
} from './core/browser.js';
import { createLogger } from './util/logger.js';
import { ToolError } from './util/errors.js';
import { resolveProfile, removeProfile } from './core/profile.js';

/**
 * @typedef {object} CaptureOptions
 * @property {string}   [url]            page to open after attaching
 * @property {number}   [port]           DevTools port (default 9333)
 * @property {string}   [out]            explicit session directory
 * @property {string}   [baseDir]        parent directory for auto-named sessions
 * @property {string}   [browser]        browser executable override
 * @property {string}   [profile]        browser profile directory
 * @property {boolean}  [attach]         never spawn; wait for an external browser
 * @property {boolean}  [headless]       headless mode (launch only)
 * @property {boolean}  [navigate]       navigate to `url` after attaching
 * @property {string[]} [include]        URL allow-list (regex)
 * @property {string[]} [exclude]        URL deny-list (regex)
 * @property {string[]} [types]          resource types to record
 * @property {boolean}  [bodies]         capture response bodies
 * @property {number}   [maxBodyBytes]   per-body cap
 * @property {boolean}  [redact]         redact credential form fields
 * @property {number}   [duration]       stop after N seconds
 * @property {number}   [idle]           stop after N idle seconds
 * @property {number}   [attachTimeout]  seconds to wait for an external browser
 * @property {boolean}  [json]           machine-readable stdout
 * @property {string}   [level]          log level
 * @property {Function} [onRecord]       callback per record
 * @property {AbortSignal} [signal]      cancellation
 */

export async function capture(options = {}) {
  const {
    url = 'about:blank',
    port = 9333,
    out,
    baseDir = process.cwd(),
    browser: browserPath,
    profile,
    reuseProfile = false,
    keepProfile = false,
    attach = false,
    headless = false,
    navigate = true,
    include = [],
    exclude = [],
    types = [],
    bodies = true,
    maxBodyBytes = 20 * 1024 * 1024,
    redact = true,
    redactKeys,
    duration = 0,
    idle = 0,
    attachTimeout = 300,
    json = false,
    level = 'info',
    logger: customLogger,
    onRecord = null,
    signal = null,
  } = options;

  const logger = customLogger ?? createLogger({ level, json });

  const portOpen = await isDebugPortOpen(port);
  const mode = portOpen ? 'attach' : attach ? 'wait' : 'launch';

  // Resolve the browser before creating any directories, so a missing browser
  // fails fast and leaves nothing behind.
  const resolved = mode === 'launch' ? resolveBrowser({ executable: browserPath }) : null;

  // Created lazily: a failed wait in attach mode should leave nothing on disk.
  let session = null;
  const openSession = () => {
    if (session) return session;
    session = Session.create({
      dir: out,
      baseDir,
      options: {
        url,
        port,
        mode,
        include,
        exclude,
        types,
        bodies,
        maxBodyBytes,
        redact,
        navigate,
        duration,
        idle,
      },
      force: Boolean(options.force),
    });
    logger.info(`session: ${session.dir}`);
    return session;
  };

  let child = null;
  let profileInfo = null;
  const cleanupFns = [];
  let stopped = false;
  let stopReason = 'unknown';
  let resolveStop;
  const stopPromise = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    stopReason = reason;
    logger.debug(`stopping: ${reason}`);
    resolveStop();
  };

  let bumpIdle = () => {};

  try {
    if (mode === 'launch') {
      openSession();
      profileInfo = resolveProfile({
        profile,
        baseDir,
        name: path.basename(session.dir),
        reuse: reuseProfile,
      });
      logger.info(`launching ${resolved.name}: ${resolved.path}`);
      logger.info(`profile: ${profileInfo.dir} (${profileInfo.mode})`);
      child = launchBrowser({
        executable: resolved.path,
        port,
        profileDir: profileInfo.dir,
        url: 'about:blank',
        headless,
      });
      cleanupFns.push(() => closeBrowser(child));
      child.once('exit', () => stop('browser-exit'));
      await waitForPort(port, { timeoutMs: 30_000, logger });
    } else {
      if (mode === 'wait') {
        logger.info(
          `waiting for a browser on port ${port}; start one with:\n` +
            `  --remote-debugging-port=${port} --user-data-dir=<dir> --no-first-run`,
        );
      }
      await waitForPort(port, { timeoutMs: attachTimeout * 1000, logger });
    }

    openSession();
    const version = await getBrowserVersion(port);
    session.setBrowser({
      ...version,
      mode,
      ...(profileInfo ? { profile: profileInfo.dir, profileMode: profileInfo.mode } : {}),
    });
    if (version?.browser) logger.debug(`connected: ${version.browser}`);

    const recorder = new Recorder({
      session,
      options: { include, exclude, types, captureBodies: bodies, maxBodyBytes, redact, redactKeys },
    });
    recorder.on('record', (rec) => {
      logger.record(rec);
      onRecord?.(rec);
      bumpIdle();
    });
    recorder.on('error', (err) => logger.warn(`recorder: ${err.message}`));

    const watcher = new TargetWatcher({ port, logger });
    cleanupFns.push(() => watcher.stop());

    let navigated = !navigate;

    watcher.on('attach', async (connection, target) => {
      try {
        await recorder.bind(connection, target);
        logger.debug(`recording target ${target.id}`);
        if (!navigated) {
          navigated = true;
          await sleep(250);
          logger.info(`opening ${url}`);
          await connection.send('Page.navigate', { url }).catch(() => {});
        }
      } catch (err) {
        logger.warn(`cannot attach to ${target.id}: ${err.message}`);
      }
    });
    watcher.on('gone', () => stop('browser-closed'));
    watcher.on('error', (err) => logger.debug(`watcher: ${err.message}`));

    await watcher.start();

    // ---- stop conditions -------------------------------------------------
    let idleTimer = null;
    bumpIdle = () => {
      if (!idle) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop('idle'), idle * 1000);
      idleTimer.unref?.();
    };
    bumpIdle();
    cleanupFns.push(() => idleTimer && clearTimeout(idleTimer));

    if (duration) {
      const t = setTimeout(() => stop('duration'), duration * 1000);
      t.unref?.();
      cleanupFns.push(() => clearTimeout(t));
    }

    const onSignal = () => stop('signal');
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    cleanupFns.push(() => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    });

    if (signal) {
      if (signal.aborted) stop('aborted');
      else signal.addEventListener('abort', () => stop('aborted'), { once: true });
    }

    logger.info('capturing — close the browser window when you are done');
    await stopPromise;

    const summary = await session.close({
      stopReason,
      recorder: recorder.stats,
      pending: recorder.pendingCount,
    });
    logger.summary({
      requests: summary.requests,
      bodies: summary.bodies,
      bytes: summary.bytes,
      failed: summary.failed,
      sessionDir: session.dir,
      stopReason,
    });

    return { summary, session, dir: session.dir, stopReason, recorder, watcher };
  } catch (err) {
    if (session && !session.meta.stats) {
      await session.close({ stopReason: 'error', error: err.message }).catch(() => {});
    }
    throw err;
  } finally {
    for (const fn of cleanupFns.reverse()) {
      try {
        await fn();
      } catch {
        /* ignore */
      }
    }
    // A per-session profile is throw-away unless the caller asked to keep it.
    // This runs after the browser has been closed, or the files stay locked.
    if (profileInfo?.ephemeral && !keepProfile) {
      const removed = removeProfile(profileInfo.dir);
      logger.debug(
        removed
          ? `removed temporary profile ${profileInfo.dir}`
          : `could not remove temporary profile ${profileInfo.dir}`,
      );
    }
  }
}

async function waitForPort(port, { timeoutMs, logger }) {
  const started = Date.now();
  let announced = false;
  while (Date.now() - started < timeoutMs) {
    if (await isDebugPortOpen(port)) return;
    if (!announced && Date.now() - started > 1500) {
      logger.info(`still waiting for port ${port} ...`);
      announced = true;
    }
    await sleep(400);
  }
  throw new ToolError(
    `DevTools port ${port} did not open within ${Math.round(timeoutMs / 1000)}s.\n` +
      'Start a browser with --remote-debugging-port and re-run with --attach, ' +
      'or let the tool launch one for you (omit --attach).',
  );
}
