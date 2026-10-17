/**
 * Browser discovery and lifecycle.
 *
 * The capture flow needs a Chromium-family browser started with
 * `--remote-debugging-port`. Two modes are supported:
 *
 *   launch  — this module spawns the browser (needs an unrestricted shell)
 *   attach  — the user starts the browser themselves and we only connect
 *
 * The second mode exists because sandboxed or locked-down environments often
 * forbid spawning a browser (Windows AppContainer blocks the named pipes
 * Chromium needs for its own IPC).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BROWSER_CANDIDATES = {
  win32: [
    { name: 'Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { name: 'Chrome', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
    {
      name: 'Chrome',
      path: path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    },
    {
      name: 'Edge',
      path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    },
    { name: 'Edge', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
    {
      name: 'Brave',
      path: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    },
  ],
  darwin: [
    { name: 'Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { name: 'Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    { name: 'Brave', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
    {
      name: 'Chrome',
      path: path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    },
  ],
  linux: [
    { name: 'Chrome', path: '/usr/bin/google-chrome' },
    { name: 'Chrome', path: '/usr/bin/google-chrome-stable' },
    { name: 'Chromium', path: '/usr/bin/chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium-browser' },
    { name: 'Edge', path: '/usr/bin/microsoft-edge' },
    { name: 'Brave', path: '/usr/bin/brave-browser' },
    { name: 'Chrome', path: '/snap/bin/chromium' },
  ],
};

/** Locate installed Chromium-family browsers, best first. */
export function discoverBrowsers({ platform = process.platform } = {}) {
  const list = BROWSER_CANDIDATES[platform] || [];
  const seen = new Set();
  const found = [];
  for (const candidate of list) {
    if (!candidate.path || seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    try {
      if (fs.existsSync(candidate.path)) found.push(candidate);
    } catch {
      /* ignore */
    }
  }
  return found;
}

/** Pick the first available browser, or throw a helpful error. */
export function resolveBrowser({ executable } = {}) {
  if (executable) {
    if (!fs.existsSync(executable)) {
      throw new Error(`browser executable not found: ${executable}`);
    }
    return { name: path.basename(executable), path: executable };
  }
  const found = discoverBrowsers();
  if (found.length === 0) {
    throw new Error(
      'no Chrome/Chromium/Edge/Brave installation found. Pass --browser <path>, ' +
        'or start a browser yourself with --remote-debugging-port and use --attach.',
    );
  }
  return found[0];
}

/** True when something already answers the DevTools HTTP endpoint. */
export async function isDebugPortOpen(port, { timeout = 800 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Block until the DevTools endpoint answers, or throw on timeout. */
export async function waitForDebugPort(port, { timeout = 30_000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await isDebugPortOpen(port)) return;
    await sleep(interval);
  }
  throw new Error(
    `DevTools port ${port} did not open within ${timeout}ms. ` +
      'If the browser is already running, close it first; Chromium ignores ' +
      '--remote-debugging-port when it reuses an existing profile.',
  );
}

/** Fetch `/json/version` — used for the session metadata. */
export async function getBrowserVersion(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) return null;
    const json = await res.json();
    return { browser: json.Browser, protocolVersion: json['Protocol-Version'], userAgent: json['User-Agent'] };
  } catch {
    return null;
  }
}

/** List debuggable targets. */
export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`cannot list targets: HTTP ${res.status}`);
  return res.json();
}

/**
 * Spawn a browser with the DevTools port open.
 * @returns {import('node:child_process').ChildProcess}
 */
export function launchBrowser({
  executable,
  port,
  profileDir,
  url = 'about:blank',
  headless = false,
  extraArgs = [],
  detached = false,
}) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    ...(headless ? ['--headless=new', '--disable-gpu'] : []),
    ...extraArgs,
    url,
  ];

  return spawn(executable, args, {
    stdio: 'ignore',
    detached,
    windowsHide: false,
  });
}

export async function closeBrowser(child, { timeout = 3000 } = {}) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill();
  } catch {
    return;
  }
  const deadline = Date.now() + timeout;
  while (child.exitCode === null && Date.now() < deadline) {
    await sleep(100);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
