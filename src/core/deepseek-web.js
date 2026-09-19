// src/core/deepseek-web.js — DeepSeek with no API key at all.
//
// Instead of an HTTP endpoint this provider drives the free chat.deepseek.com
// web app in a Chrome profile you log into once. It exposes the same interface
// as the HTTP providers in providers.js, so the agent loop cannot tell the
// difference:
//
//   createMessage({ system, tools, history, model }) -> { text, toolCalls, stopReason }
//
// Two models, matching the two things the free web UI can do:
//   deepseek-web        DeepSeek-V3, DeepThink off
//   deepseek-web-think  DeepSeek-R1, DeepThink on

import { getBrowser, getPage, defaultProfileDir } from './browser.js';
import { buildToolPrompt, parseToolCall, stripToolCall, formatToolResult, hasToolAttempt, malformedToolMessage } from './text-tools.js';

const CHAT_URL = 'https://chat.deepseek.com/';
const URL_MATCH = /chat\.deepseek\.com/;

// An assistant reply is ONE container. `[class*="ds-markdown"]` also matches its
// paragraphs and inline spans — taking the last of those yields a fragment like
// "<END>" instead of the message, so the container class is matched exactly.
const REPLY_SELECTOR = '.ds-markdown:not([class*="ds-markdown-"])';
const REPLY_FALLBACK = '[class*="ds-assistant-message"], [class*="ds-markdown"]';
const INPUT_SELECTOR = '#chat-input, textarea[placeholder], textarea';

export const WEB_MODELS = {
  'deepseek-web':       { think: false, label: 'DeepSeek-V3 (free web chat)' },
  'deepseek-web-think': { think: true,  label: 'DeepSeek-R1 / DeepThink (free web chat)' },
};

const ALIASES = {
  'deepseek-web-chat': 'deepseek-web',
  'deepseek-web-v3': 'deepseek-web',
  'deepseek-web-r1': 'deepseek-web-think',
  'deepseek-web-reasoner': 'deepseek-web-think',
  'deepthink': 'deepseek-web-think',
  // Accepted when the provider is already deepseek-web.
  'deepseek-chat': 'deepseek-web',
  'deepseek-reasoner': 'deepseek-web-think',
};

export function resolveWebModel(name) {
  const key = String(name || '').toLowerCase().trim();
  const id = ALIASES[key] || key;
  return WEB_MODELS[id] ? id : null;
}

export class DeepSeekWebProvider {
  /**
   * A chat UI has no system prompt, so standing instructions cannot be a field
   * on the request — they are sent as the opening message of the new chat,
   * before anything else. The agent skips inlining them when this is set.
   */
  separateInstructions = true;

  constructor({ name = 'deepseek-web', model, config = {}, ui = null } = {}) {
    this.name = name;
    this.ui = ui;
    this.config = config;
    this.modelId = resolveWebModel(model) || 'deepseek-web';
    this.verbose = config.verbose;

    // --resume: reopen a SPECIFIC past thread chosen from the picker. Resuming
    // is URL-based only — without a URL there is nothing safe to continue, so we
    // start fresh rather than grabbing whatever tab happens to be open (that was
    // the "loads a wrong/new chat" bug). A resumed thread already holds the
    // primer and instructions, so those are skipped only when a URL is set.
    this.resumeUrl = config.resumeUrl || null;
    this.threadUrl = this.resumeUrl || '';   // exposed so a session can record it

    this.browser = null;
    this.page = null;
    this.ready = false;
    this.primed = !!this.resumeUrl;          // system prompt + tool docs already sent?
    this.instructionsSent = !!this.resumeUrl;
    this.thinking = null;         // DeepThink state we last applied
    this.thinkVerified = false;
    this._callSeq = 0;
    this._pendingToolName = null;

    this.opts = {
      port: Number(config.deepseekPort) || 9222,
      profileDir: config.deepseekProfile || defaultProfileDir(),
      headless: config.deepseekHeadless === true || config.deepseekHeadless === 'true',
      chromePath: config.chromePath || null,
      firstTokenTimeout: Number(config.deepseekFirstTokenTimeout) || 180000,
      hardTimeout: Number(config.deepseekTimeout) || 600000,
      stabilityMs: Number(config.deepseekStabilityMs) || 2500,
      maxPrimerChars: Number(config.deepseekMaxPrimerChars) || 24000,
    };
  }

  get label() {
    return WEB_MODELS[this.modelId].label;
  }

  /** The web UI has exactly these two free modes. */
  async listModels() {
    return Object.keys(WEB_MODELS).map(id => ({ id, free: true, tools: true, hasPricing: false }));
  }

  // ---- session ----------------------------------------------------------

  async init({ newThread = true } = {}) {
    if (this.ready) return this;
    const { browser } = await getBrowser({
      port: this.opts.port,
      profileDir: this.opts.profileDir,
      headless: this.opts.headless,
      chromePath: this.opts.chromePath,
      startUrl: CHAT_URL,
    });
    this.browser = browser;

    if (this.resumeUrl) {
      // Reopen the exact past thread picked from `da --resume`.
      this.page = await browser.newPage();
      await this.page.goto(this.resumeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this._requireLogin();
    } else {
      // Fresh chat. A DeepSeek thread keeps its whole history, so reusing an
      // open tab would drag a previous conversation's context into every new
      // request. Open our own tab, close any other chat tabs so they cannot be
      // picked up, and verify the conversation is empty.
      for (const pg of await browser.pages()) {
        try { if (URL_MATCH.test(pg.url())) await pg.close(); } catch { /* gone */ }
      }
      this.page = await browser.newPage();
      await this.page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this._requireLogin();
      await this._ensureEmptyChat();
    }

    this.ready = true;
    return this;
  }

  /** Make sure we are on an empty conversation, not a restored old thread. */
  async _ensureEmptyChat() {
    const { count } = await this._readLastBlock();
    if (count === 0) return;
    const clicked = await this.page.evaluate(() => {
      const wanted = /new chat|neuer chat|neue unterhaltung/i;
      const el = [...document.querySelectorAll('button,[role="button"],a,div,span')]
        .find(e => wanted.test((e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '').trim().slice(0, 30)));
      if (el) { (el.closest('button,[role="button"],a') || el).click(); return true; }
      return false;
    }).catch(() => false);
    if (!clicked) {
      await this.page.goto(CHAT_URL + '?_=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 800));
  }

  async close({ closeBrowser = false } = {}) {
    try {
      if (closeBrowser && this.browser) await this.browser.close();
      else if (this.browser) await this.browser.disconnect();
    } catch { /* browser already gone */ }
    this.ready = false;
  }

  async isLoggedIn() {
    if (!this.page) return false;
    return this.page.evaluate(sel => !!document.querySelector(sel), INPUT_SELECTOR).catch(() => false);
  }

  async _requireLogin() {
    const ok = await this.page
      .waitForSelector(INPUT_SELECTOR, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      throw new Error(
        'Not logged in to chat.deepseek.com.\n' +
        '  Run: da deepseek login   (sign in once in the Chrome window, free account is enough)'
      );
    }
  }

  // ---- provider interface ----------------------------------------------

  async createMessage({ system, tools, history, model, instructions }) {
    const wanted = resolveWebModel(model) || this.modelId;
    if (wanted !== this.modelId) {
      this.modelId = wanted;
      this.thinkVerified = false;
    }

    // Fresh chat by default; --resume reuses the last open thread.
    await this.init();
    await this._applyThinking(WEB_MODELS[this.modelId].think);

    // Opening message of a fresh chat, ahead of the primer and the request.
    if (instructions && !this.instructionsSent) {
      this.instructionsSent = true;
      this.ui?.info('Sending standing instructions as the first message…');
      await this._send(instructions);
    }

    const outgoing = this._composeTurn({ system, tools, history });
    let reply = await this._send(outgoing);

    // Remember which thread this is, so a session can reopen it later.
    try {
      const u = this.page.url();
      if (/\/a\/chat\/s\//.test(u)) this.threadUrl = u;
    } catch { /* page gone */ }

    // A tool call whose JSON could not be parsed used to end the turn
    // silently (no tool ran, no RESULT line). Instead, tell the model its
    // call was malformed and let it resend — up to twice.
    let call = parseToolCall(reply);
    let repairs = 0;
    while (!call && hasToolAttempt(reply) && repairs < 2) {
      repairs++;
      this.ui?.warn('DeepSeek sent a malformed tool call — asking it to resend as valid JSON.');
      reply = await this._send(malformedToolMessage());
      call = parseToolCall(reply);
    }
    const text = stripToolCall(reply);
    this._pendingToolName = call?.name ?? null;

    return {
      text,
      toolCalls: call ? [{ id: `web-${++this._callSeq}`, name: call.name, input: call.input }] : [],
      stopReason: call ? 'tool_use' : 'end_turn',
    };
  }

  /**
   * The web chat keeps the conversation itself, so only the newest turn is
   * sent — with the system prompt and tool docs prepended on the first call.
   */
  _composeTurn({ system, tools, history }) {
    const last = history[history.length - 1];

    if (last?.role === 'tool') {
      return last.results
        .map(r => formatToolResult(this._pendingToolName || 'tool', r.output))
        .join('\n\n');
    }

    const userText = last?.text ?? '';
    if (this.primed) return userText;

    this.primed = true;
    return `${system}\n${buildToolPrompt(tools)}\n\n---\nThe developer's first request follows.\n\n${userText}`;
  }

  // ---- DeepThink toggle -------------------------------------------------

  async _applyThinking(want) {
    if (this.thinking === want) return;
    const state = await this.page.evaluate((want) => {
      const isBlueish = (css) => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css || '');
        if (!m) return false;
        const r = +m[1], g = +m[2], b = +m[3];
        return b > r + 35 && b > g + 35;
      };
      const wanted = /deepthink|deep think|tiefes denken/i;
      const hits = [...document.querySelectorAll('button,[role="button"],div,span')].filter((el) => {
        const t = (el.textContent || '').trim();
        return t.length > 0 && t.length < 40 && wanted.test(t);
      });
      if (!hits.length) return { found: false };

      const el = hits[hits.length - 1];
      const target = el.closest('button,[role="button"]') || el;
      const pressed = target.getAttribute('aria-pressed');
      const active = pressed !== null
        ? pressed === 'true'
        : (() => {
            const cs = getComputedStyle(target);
            return isBlueish(cs.color) || isBlueish(cs.backgroundColor);
          })();

      if (active !== want) {
        target.click();
        return { found: true, clicked: true };
      }
      return { found: true, clicked: false };
    }, want);

    if (!state.found && want) {
      this.ui?.warn('DeepThink toggle not found on the page — continuing without it.');
    }
    this.thinking = want;
    await new Promise(r => setTimeout(r, 400));
  }

  // ---- messaging --------------------------------------------------------

  async _send(text) {
    const before = await this._readLastBlock();
    await this._fillInput(text);
    await this._submit();
    await this._waitForReplyStart(before);
    const reply = await this._waitForStableReply(before);

    if (WEB_MODELS[this.modelId].think && !this.thinkVerified) {
      this.thinkVerified = true;
      const thought = await this.page.evaluate(
        () => /thought for|thinking|nachgedacht/i.test(document.body.innerText.slice(0, 20000))
      ).catch(() => true);
      if (!thought) {
        this.thinking = null;
        await this._applyThinking(true);
        this.ui?.warn('DeepThink did not look active — switched it on for the next turn.');
      }
    }

    return reply;
  }

  async _fillInput(text) {
    await this.page.bringToFront().catch(() => {});
    await this.page.evaluate((value, sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('chat input not found');
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, text, INPUT_SELECTOR);
    await this.page.focus(INPUT_SELECTOR).catch(() => {});
    await new Promise(r => setTimeout(r, 200));
  }

  /** Whether the composer still holds text (i.e. nothing was sent yet). */
  async _inputPending() {
    return this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return !!el && el.value.trim().length > 0;
    }, INPUT_SELECTOR);
  }

  /**
   * Enter alone is unreliable — a background tab or a re-render can swallow the
   * keypress and the prompt just sits in the box. So: press Enter, verify, and
   * fall back to the composer's send button (the filled primary one).
   */
  async _submit() {
    await this.page.keyboard.press('Enter').catch(() => {});
    if (!(await this._waitUntilSent())) {
      const clicked = await this.page.evaluate((sel) => {
        const input = document.querySelector(sel);
        if (!input) return false;
        const box = input.closest('div')?.parentElement?.parentElement || document.body;
        const buttons = [...box.querySelectorAll('div[role="button"],button,.ds-button')];
        const send = buttons.reverse().find(el =>
          el.classList.contains('ds-button--primary') ||
          /send/i.test(el.getAttribute('aria-label') || '')
        );
        if (!send) return false;
        send.click();
        return true;
      }, INPUT_SELECTOR);
      if (!clicked || !(await this._waitUntilSent())) {
        throw new Error('Could not submit the prompt to chat.deepseek.com (the composer still holds it).');
      }
    }
  }

  async _waitUntilSent(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this._inputPending())) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  }

  /**
   * Wait for a NEW answer to appear. Counting reply containers does not work:
   * the app recycles older messages out of the DOM, so the count can stay flat
   * or even drop across turns. Comparing the newest container's content does.
   */
  async _waitForReplyStart(before) {
    const deadline = Date.now() + this.opts.firstTokenTimeout;
    while (Date.now() < deadline) {
      const cur = await this._readLastBlock();
      if (cur.text && (cur.text !== before.text || cur.count !== before.count)) return cur;

      const problem = await this.page.evaluate(() => {
        const t = document.body.innerText || '';
        if (/server is busy/i.test(t)) return 'DeepSeek says the server is busy - try again in a moment.';
        if (/reached the limit|message limit/i.test(t)) return 'DeepSeek message limit reached for now.';
        return null;
      });
      if (problem) throw new Error(problem);
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('DeepSeek did not start answering in time.');
  }

  async _waitForStableReply(before) {
    const deadline = Date.now() + this.opts.hardTimeout;
    let last = '';
    let lastCount = -1;
    let stableSince = Date.now();

    while (Date.now() < deadline) {
      const { text, count } = await this._readLastBlock();
      // Still showing the previous turn's answer: not our reply yet.
      if (text === before.text && count === before.count) {
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      if (count !== lastCount || text !== last) {
        last = text;
        lastCount = count;
        stableSince = Date.now();
      } else if (text && Date.now() - stableSince >= this.opts.stabilityMs) {
        return text;
      }
      await new Promise(r => setTimeout(r, 600));
    }
    if (last) return last;
    throw new Error('DeepSeek answer timed out.');
  }

  /** Read the newest assistant block and serialize its DOM back into markdown. */
  async _readLastBlock() {
    return this.page.evaluate((sel, fallback) => {
      let blocks = document.querySelectorAll(sel);
      if (!blocks.length) blocks = document.querySelectorAll(fallback);
      const count = blocks.length;
      const root = blocks[count - 1];
      if (!root) return { text: '', count };

      const inline = (node) => {
        let out = '';
        node.childNodes.forEach((c) => { out += ser(c, true); });
        return out;
      };

      const ser = (node, isInline) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = node.tagName.toLowerCase();

        switch (tag) {
          case 'br': return '\n';
          case 'hr': return '\n---\n';
          case 'strong': case 'b': return '**' + inline(node) + '**';
          case 'em': case 'i': return '*' + inline(node) + '*';
          case 'del': return '~~' + inline(node) + '~~';
          case 'a': return '[' + inline(node) + '](' + (node.getAttribute('href') || '') + ')';
          case 'code':
            return node.closest('pre') ? node.innerText : '`' + node.innerText + '`';
          case 'pre': {
            const codeEl = node.querySelector('code');
            const cls = (codeEl && codeEl.className) || '';
            const langMatch = /language-([\w+-]+)/.exec(cls);
            const lang = langMatch ? langMatch[1] : '';
            const body = (codeEl ? codeEl.innerText : node.innerText).replace(/\n+$/, '');
            return '\n```' + lang + '\n' + body + '\n```\n';
          }
          case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
            return '\n' + '#'.repeat(+tag[1]) + ' ' + inline(node).trim() + '\n';
          case 'blockquote':
            return '\n' + inline(node).trim().split('\n').map(l => '> ' + l).join('\n') + '\n';
          case 'ul': case 'ol': {
            const ordered = tag === 'ol';
            let i = 0;
            let out = '\n';
            node.querySelectorAll(':scope > li').forEach((li) => {
              i++;
              const marker = ordered ? i + '. ' : '- ';
              out += marker + inline(li).trim().split('\n').join('\n  ') + '\n';
            });
            return out;
          }
          case 'li': return inline(node);
          case 'p': case 'div': case 'section': {
            const body = inline(node);
            return isInline ? body : '\n' + body + '\n';
          }
          case 'table': {
            let out = '\n';
            [...node.querySelectorAll('tr')].forEach((tr, idx) => {
              const cells = [...tr.children].map(td => inline(td).trim().replace(/\|/g, '\\|'));
              out += '| ' + cells.join(' | ') + ' |\n';
              if (idx === 0) out += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
            });
            return out + '\n';
          }
          default: return inline(node);
        }
      };

      const text = ser(root, false)
        .replace(/ /g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { text, count };
    }, REPLY_SELECTOR, REPLY_FALLBACK);
  }
}

/**
 * List the user's existing chats from the DeepSeek sidebar so `da --resume`
 * can offer them, not just locally-recorded sessions. Returns [{ title, url }]
 * newest-first (sidebar order), deduped. Leaves the browser running so the
 * chat that follows can reuse it.
 */
export async function listDeepSeekThreads(config = {}, limit = 25) {
  const port = Number(config.deepseekPort) || 9222;
  const { browser } = await getBrowser({
    port,
    profileDir: config.deepseekProfile || defaultProfileDir(),
    headless: config.deepseekHeadless === true || config.deepseekHeadless === 'true',
    chromePath: config.chromePath || null,
    startUrl: CHAT_URL,
  });
  try {
    const page = await getPage(browser, URL_MATCH, CHAT_URL);
    // A logged-out page has no sidebar; don't hang waiting for one.
    const loggedIn = await page.waitForSelector('#chat-input, textarea', { timeout: 15000 })
      .then(() => true).catch(() => false);
    if (!loggedIn) return [];
    await new Promise(r => setTimeout(r, 2500)); // let the history list render

    const threads = await page.evaluate(() => {
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll('a[href*="/a/chat/s/"]')) {
        const href = a.getAttribute('href') || '';
        const url = href.startsWith('http') ? href : 'https://chat.deepseek.com' + href;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title: (a.textContent || '').trim().slice(0, 60) || '(untitled)', url });
      }
      return out;
    });
    return threads.slice(0, limit);
  } finally {
    try { await browser.disconnect(); } catch { /* keep running */ }
  }
}
