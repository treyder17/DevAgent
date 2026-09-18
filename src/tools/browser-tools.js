// src/tools/browser-tools.js — "Dev in Chrome": let the agent drive a real,
// visible browser the way Claude-in-Chrome does — open pages, read them, click.
//
// This is a workspace browser you watch, separate from the (headless) DeepSeek
// chat bridge: its own debug port and profile, visible by default. It reuses
// core/browser.js, so the Chrome-for-Testing fallback and the enterprise-policy
// handling come for free.

import { join } from 'path';
import { homedir } from 'os';
import { getBrowser } from '../core/browser.js';
import { cleanUrl } from './web.js';

const MAX_TEXT = 12000;
let session = null; // { browser, page }

function opts(config = {}) {
  return {
    port: Number(config.browsePort) || 9223,
    profileDir: config.browseProfile || join(homedir(), '.devagent', 'browse-profile'),
    // Visible on purpose — you should see what it does. Set browseHeadless to hide.
    headless: config.browseHeadless === true || config.browseHeadless === 'true',
    chromePath: config.chromePath || null,
  };
}

async function ensure(config) {
  if (session?.page) {
    try { if (!session.page.isClosed()) return session; } catch { /* recreate */ }
  }
  const o = opts(config);
  const { browser } = await getBrowser({ ...o, startUrl: 'about:blank' });
  const pages = await browser.pages();
  const page = pages.find(p => !/^devtools:/.test(p.url())) || await browser.newPage();
  session = { browser, page };
  return session;
}

async function pageText(page) {
  const text = await page.evaluate(() => {
    const el = document.querySelector('main, article, #content, body') || document.body;
    return (el.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  }).catch(() => '');
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n…[truncated]' : text;
}

export async function browserOpen(url, config) {
  url = cleanUrl(url);
  const { page } = await ensure(config);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 800)); // let client-rendered pages settle
  const title = await page.title().catch(() => '');
  return { ok: true, url: page.url(), title, text: await pageText(page) };
}

export async function browserRead(config) {
  if (!session?.page) return { ok: false, error: 'No page open. Use browser_open first.' };
  const { page } = session;
  return { ok: true, url: page.url(), title: await page.title().catch(() => ''), text: await pageText(page) };
}

/**
 * Click an element by visible text (case-insensitive substring) or, if the
 * target looks like a CSS selector, by selector.
 */
export async function browserClick(target, config) {
  if (!session?.page) return { ok: false, error: 'No page open. Use browser_open first.' };
  const { page } = session;
  const result = await page.evaluate((target) => {
    const clickable = 'a,button,[role="button"],input[type="submit"],input[type="button"]';
    let el = null;
    // Try as a CSS selector first when it looks like one.
    if (/[.#\[]/.test(target)) { try { el = document.querySelector(target); } catch { /* not a selector */ } }
    if (!el) {
      const needle = target.trim().toLowerCase();
      el = [...document.querySelectorAll(clickable)].find(e => {
        const t = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase();
        return t && t.includes(needle);
      });
    }
    if (!el) return { found: false };
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 60);
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { found: true, label };
  }, target).catch((e) => ({ found: false, error: e.message }));

  if (!result.found) return { ok: false, error: `No clickable element matching "${target}".` };
  await new Promise(r => setTimeout(r, 900)); // allow navigation / DOM update
  return { ok: true, clicked: result.label, url: page.url(), title: await page.title().catch(() => '') };
}

export async function browserClose() {
  try { if (session?.browser) await session.browser.disconnect(); } catch { /* gone */ }
  session = null;
}

export const BROWSER_TOOLS = [
  {
    name: 'browser_open',
    description: `Open a URL in a real, visible Chrome window and return the page title and readable text.
Use to visit a site, a web app, a dashboard, docs — anything you need to see or act on in a browser.`,
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to open.' } },
      required: ['url'],
    },
  },
  {
    name: 'browser_read',
    description: `Read the readable text of the page currently open in the browser. Use after browser_open or browser_click to see the new state.`,
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_click',
    description: `Click an element on the current page, by its visible text (e.g. "Login", "Accept") or a CSS selector (e.g. "#submit", ".btn-primary"). Then re-read to see what changed.`,
    input_schema: {
      type: 'object',
      properties: { target: { type: 'string', description: 'Visible text of the element, or a CSS selector.' } },
      required: ['target'],
    },
  },
];
