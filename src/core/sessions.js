// src/core/sessions.js — persist chat sessions so `da --resume` can list and
// reopen them, the way `claude --resume` does.
//
// One JSON file per session under ~/.devagent/sessions/. For the DeepSeek
// bridge the important key is `threadUrl`: reopening it continues that exact
// chat, whose full history DeepSeek keeps server-side.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DIR = join(homedir(), '.devagent', 'sessions');

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Create and persist a new session record. */
export function createSession({ cwd, provider, model }) {
  ensureDir();
  const s = {
    id: newId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd, provider, model,
    firstPrompt: '',
    lastPrompt: '',
    turns: 0,
    threadUrl: '',
  };
  save(s);
  return s;
}

export function save(session) {
  ensureDir();
  session.updatedAt = new Date().toISOString();
  writeFileSync(join(DIR, `${session.id}.json`), JSON.stringify(session, null, 2));
  return session;
}

/** Record one exchange onto a session. */
export function recordTurn(session, prompt, threadUrl) {
  if (!session.firstPrompt) session.firstPrompt = prompt.slice(0, 200);
  session.lastPrompt = prompt.slice(0, 200);
  session.turns += 1;
  if (threadUrl) session.threadUrl = threadUrl;
  save(session);
}

/** All sessions, newest first. */
export function listSessions(limit = 30) {
  ensureDir();
  const out = [];
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(readFileSync(join(DIR, f), 'utf8'))); } catch { /* skip bad file */ }
  }
  out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return out.slice(0, limit);
}

export function getSession(id) {
  const p = join(DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** Human-friendly one-line label for the picker. */
export function describe(s) {
  const when = relativeTime(s.updatedAt);
  const where = shorten(s.cwd || '', 28);
  const what = (s.firstPrompt || '(empty)').replace(/\s+/g, ' ').slice(0, 54);
  const turns = s.turns ? `${s.turns} msg` : 'new';
  return `${when.padEnd(12)} ${where.padEnd(30)} ${turns.padEnd(7)} ${what}`;
}

function shorten(p, n) {
  return p.length <= n ? p : '…' + p.slice(-(n - 1));
}

function relativeTime(iso) {
  if (!iso) return '?';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
