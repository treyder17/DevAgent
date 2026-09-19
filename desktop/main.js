// desktop/main.js — Electron main process.
// Runs the DevAgent engine in Node and bridges it to the chat window over IPC.

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';

import { Agent } from '../src/core/agent.js';
import { CONFIG } from '../src/core/config.js';
import { PluginManager } from '../src/core/plugins.js';
import { createSession, recordTurn } from '../src/core/sessions.js';
import { activate, isActivated, reportActivation } from '../src/core/license.js';
import { makeAppUI } from './app-ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let win = null;
let agent = null;
let session = null;
let workdir = homedir();
let busy = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'DevAgent',
    backgroundColor: '#0e0e12',
    webPreferences: {
      // main runs from build/main.mjs, so preload/renderer sit one level up.
      preload: join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu?.();
  win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

/** Build the agent on first use (keeps startup instant). */
async function ensureAgent() {
  if (agent) return agent;
  const config = await CONFIG.load({});     // uses ~/.devagent/config.json (deepseek-web headless by default)
  config.ui = makeAppUI(send);
  const plugins = new PluginManager(config);
  await plugins.loadAll();
  agent = new Agent({ config, codebaseIndex: null, plugins, workdir, ui: config.ui });
  session = createSession({ cwd: workdir, provider: config.provider, model: config.model });
  send('ready', { provider: config.provider, model: config.model, workdir });
  return agent;
}

ipcMain.handle('license:status', async () => {
  const config = await CONFIG.load({});
  return { activated: isActivated(config) };
});

ipcMain.handle('license:activate', async (_e, key) => {
  const r = activate(key, CONFIG); // { ok } or { ok:false, error }
  if (r.ok) {
    const cfg = await CONFIG.load({});
    reportActivation(cfg, { via: 'app' }).catch(() => {});
  }
  return r;
});

ipcMain.handle('chat:send', async (_e, text) => {
  const cfg = await CONFIG.load({});
  if (!isActivated(cfg)) return { ok: false, error: 'DevAgent is locked. Enter an access key.' };
  if (busy) return { ok: false, error: 'A request is already running.' };
  busy = true;
  try {
    const a = await ensureAgent();
    await a.chat(text);
    recordTurn(session, text, a.threadUrl);
    return { ok: true };
  } catch (err) {
    send('log', { kind: 'error', text: err.message });
    return { ok: false, error: err.message };
  } finally {
    busy = false;
    send('status', { state: 'idle' });
  }
});

ipcMain.handle('chat:clear', async () => {
  agent?.clearHistory?.();
  return { ok: true };
});

ipcMain.handle('workdir:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  workdir = resolve(r.filePaths[0]);
  // Rebuild the agent so it works in the new folder.
  agent = null;
  await ensureAgent();
  return { ok: true, workdir };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => {
  try { await agent?.dispose?.(); } catch { /* ignore */ }
  if (process.platform !== 'darwin') app.quit();
});
