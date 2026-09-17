// src/core/browser.js — launch or attach to a real Chrome instance via CDP.
// Used by browser-backed providers (e.g. the DeepSeek web chat) so DevAgent can
// reuse an already logged-in browser session instead of an API key.

import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn, execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findChrome(explicit) {
  const candidates = [explicit, managedFreeChrome(), ...CHROME_CANDIDATES].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function defaultProfileDir() {
  return join(homedir(), '.devagent', 'chrome-profile');
}

export function browsersDir() {
  return join(homedir(), '.devagent', 'browsers');
}

/**
 * A "Chrome for Testing" build downloaded by `da deepseek install-browser`.
 * It ignores enterprise policies, so it works where a managed Chrome pins
 * --user-data-dir and refuses to open a debugging port.
 */
export function managedFreeChrome() {
  const root = browsersDir();
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === 'chrome.exe' || e.name === 'chrome' || e.name === 'Google Chrome for Testing') {
        return full;
      }
    }
  }
  return null;
}

/** Is a normal Chrome already running? Its instance swallows our launch. */
export function chromeRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH'], {
        encoding: 'utf8', windowsHide: true,
      });
      return /chrome\.exe/i.test(out);
    }
    const out = execFileSync('pgrep', ['-x', 'chrome'], { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** Windows policy that pins the profile dir and makes --user-data-dir a no-op. */
export function profilePolicyActive() {
  if (process.platform !== 'win32') return false;
  for (const root of ['HKLM', 'HKCU']) {
    try {
      const out = execFileSync(
        'reg',
        ['query', `${root}\\SOFTWARE\\Policies\\Google\\Chrome`, '/v', 'UserDataDir'],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      if (/UserDataDir/i.test(out)) return true;
    } catch { /* policy not set */ }
  }
  return false;
}

async function endpointAlive(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForEndpoint(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await endpointAlive(port)) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/**
 * Connect to a Chrome with an open DevTools endpoint, starting one if needed.
 * The browser keeps its own persistent profile, so a login survives restarts.
 */
export async function getBrowser({
  port = 9222,
  profileDir = defaultProfileDir(),
  headless = false,
  chromePath = null,
  startUrl = 'about:blank',
} = {}) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    throw new Error('puppeteer-core is not installed. Run: npm install puppeteer-core');
  }

  let launched = false;

  if (!(await endpointAlive(port))) {
    const exe = findChrome(chromePath);
    if (!exe) {
      throw new Error(
        'Chrome not found. Install Google Chrome, or point DevAgent at it: ' +
        'da config set chromePath "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
      );
    }
    if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,OptimizationHints',
      startUrl,
    ];
    if (headless) args.unshift('--headless=new');

    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();
    launched = true;

    if (!(await waitForEndpoint(port))) {
      throw new Error(launchDiagnosis(port, exe));
    }
  }

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
  });

  return { browser, launched, port, profileDir };
}

/** Explain the most common reason a launch produced no debugging endpoint. */
function launchDiagnosis(port, exe) {
  const lines = [`Chrome did not expose a debugging endpoint on port ${port}.`];
  const policy = profilePolicyActive();
  const running = chromeRunning();

  if (policy || running) {
    if (policy) {
      lines.push(
        'Your system policy (UserDataDir) pins Chrome to one profile, so a running Chrome',
        'swallows new windows instead of starting a debuggable instance.'
      );
    } else {
      lines.push('An existing Chrome instance took over the new window.');
    }
    lines.push('Fix it in one of these ways:');
    lines.push('  1. Close ALL Chrome windows, then run the command again.');
    lines.push('  2. Use an isolated, policy-free browser: da deepseek install-browser');
    lines.push(`  3. Start Chrome yourself: "${exe}" --remote-debugging-port=${port}`);
  } else {
    lines.push('Try closing all Chrome windows and running the command again.');
  }
  return lines.join('\n');
}

/** Find a tab whose URL matches, otherwise open a new one. */
export async function getPage(browser, urlMatch, url) {
  const pages = await browser.pages();
  for (const p of pages) {
    try {
      if (urlMatch.test(p.url())) return p;
    } catch { /* tab vanished */ }
  }
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return page;
}
