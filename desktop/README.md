# DevAgent Desktop

A cross-platform desktop app (Windows, macOS, Linux) for DevAgent. It runs the
**same engine** as the `da` CLI — providers, the key-free DeepSeek bridge, the
tools (files, shell, web, browser) — behind an Electron GUI instead of the
terminal. No API key needed; it uses your existing DeepSeek login by default.

## Run it (development)

```bash
cd desktop
npm install        # downloads Electron (~200 MB, once)
npm start
```

The window opens a chat. Type a request and press Enter (Shift+Enter for a new
line). Tool calls, web/browser actions and the model's answers stream in live.
`📁 Folder` picks the working directory the agent operates in; `✳ New` starts a
fresh conversation.

## Build installers

```bash
npm run dist          # for the current OS
npm run dist:win      # Windows  .exe (NSIS)
npm run dist:mac      # macOS    .dmg
npm run dist:linux    # Linux    .AppImage
```

Output lands in `desktop/dist/`.

## How it fits together

```
Electron main (Node)                 renderer (chat UI)
  main.js  ── Agent, providers ──┐      index.html / renderer.js
  app-ui.js → IPC events ────────┼───►  shows messages, tools, status
  preload.cjs (safe bridge) ─────┘◄───  sends your prompt back
```

`app-ui.js` implements the same UI surface `agent.js` expects, so the engine is
reused unchanged — every fix and feature in the CLI is available here too.

Settings live in the shared `~/.devagent/config.json`, so `da config set …`
from the CLI also configures the app (model, DeepSeek headless, etc.).
