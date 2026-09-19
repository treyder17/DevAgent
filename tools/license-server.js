// tools/license-server.js — a tiny activation registry so you can see who has
// DevAgent. Every app/CLI that activates POSTs here; you view the list.
//
// Run it somewhere reachable by your users (a small VPS, Railway, a home box
// with a tunnel, etc.), then point clients at it:
//   da config set licenseReportUrl https://YOUR-HOST/report
//   da config set licenseRosterUrl https://YOUR-HOST/roster?token=YOUR_ADMIN_TOKEN
//
// Storage is a JSON file next to this script. No database needed.
//
//   PORT=8080 ADMIN_TOKEN=secret123 node tools/license-server.js

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, 'activations.json');
const PORT = Number(process.env.PORT) || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function load() { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(db) { writeFileSync(FILE, JSON.stringify(db, null, 2)); }

function body(req) {
  return new Promise((res) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } });
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST' && url.pathname === '/report') {
    const p = await body(req);
    if (!p.device) { res.writeHead(400).end('bad'); return; }
    const db = load();
    const prev = db[p.device] || {};
    db[p.device] = {
      device: p.device,
      key: p.key || prev.key || '',
      host: p.host || prev.host || '',
      platform: p.platform || prev.platform || '',
      via: p.via || prev.via || '',
      firstSeen: prev.firstSeen || p.at || new Date().toISOString(),
      lastSeen: p.at || new Date().toISOString(),
      count: (prev.count || 0) + 1,
    };
    save(db);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/roster') {
    if (ADMIN_TOKEN && url.searchParams.get('token') !== ADMIN_TOKEN) {
      res.writeHead(401).end('unauthorized'); return;
    }
    const rows = Object.values(load()).sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(rows, null, 2));
    return;
  }

  res.writeHead(404).end('not found');
}).listen(PORT, () => console.log(`DevAgent license registry on :${PORT}`));
