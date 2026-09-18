# DevAgent (`da`)

> AI coding assistant for your terminal — codebase-aware, agent-powered.

DevAgent gives you an AI assistant that understands your entire project and can take real actions: run tests, write code, manage git, and more — all from a single `da` command.

It works with multiple model providers — **Anthropic (Claude)**, **DeepSeek**, **OpenRouter**, and any **OpenAI-compatible** endpoint.

**Or with no API key at all.** The `deepseek-web` provider drives the free
[chat.deepseek.com](https://chat.deepseek.com) web app in a browser you sign into once:

| Model | What it is |
|-------|------------|
| `deepseek-web` | DeepSeek-V3 — the free chat model |
| `deepseek-web-think` | DeepSeek-R1 — the same chat with **DeepThink** switched on |

```bash
da deepseek login                       # once, in a Chrome window
da -m deepseek-web "explain this repo"
da --think "why does this test flake?"  # DeepThink / R1
```

See **[USEFREE.md](./USEFREE.md)** for all the free routes.

---

## Install

### macOS / Linux
```bash
curl -fsSL https://raw.githubusercontent.com/treyder17/DevAgent/main/scripts/install.sh | bash
```

### Windows (PowerShell)
```powershell
iwr -useb https://raw.githubusercontent.com/treyder17/DevAgent/main/scripts/install.ps1 | iex
```

### Manual (any platform with Node.js 18+)
```bash
git clone https://github.com/treyder17/DevAgent.git ~/.devagent/src
cd ~/.devagent/src && npm install
# Add to PATH: alias da="node ~/.devagent/src/src/da.js"
```

---

## Setup

### No key: DeepSeek in your browser

```bash
da deepseek login          # opens Chrome, sign in to your free DeepSeek account
da config set model deepseek-web        # or deepseek-web-think for DeepThink
da "what does this codebase do?"
```

DevAgent opens `chat.deepseek.com` in its own Chrome profile
(`~/.devagent/chrome-profile`), types prompts into the real chat and reads the answers
back — the login is stored, so you do it once.

```bash
da deepseek status           # profile, browser, port
da deepseek test             # one round trip through the bridge
da deepseek install-browser  # isolated Chrome, for managed machines
da deepseek logout --force   # forget the stored session
```

If `da deepseek login` reports that no debugging port opened, a running Chrome — or a
managed `UserDataDir` policy — swallowed the new window. Close all Chrome windows and
retry, or run `da deepseek install-browser` once: it downloads a standalone
*Chrome for Testing* build to `~/.devagent/browsers` that ignores enterprise policies
and runs beside your normal Chrome.

### With a key

Pick a provider and set its key. DevAgent auto-detects the provider from the model name.

**Anthropic (Claude) — default**
```bash
da config set api-key sk-ant-...        # from console.anthropic.com
```

**DeepSeek (cheap / free) — see [USEFREE.md](./USEFREE.md)**
```bash
da config set deepseekApiKey sk-...     # from platform.deepseek.com
da config set model deepseek-chat
```

**OpenRouter (free DeepSeek models)**
```bash
da config set openrouterApiKey sk-or-...            # from openrouter.ai
da config set model deepseek/deepseek-chat-v3-0324:free
```

Each provider also reads its matching env var automatically: `ANTHROPIC_API_KEY`,
`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`. The `deepseek-web`
provider needs none of them.

---

## Standing instructions (`DEVAGENT.md`)

Put a `DEVAGENT.md` in your project root and DevAgent hands it to the model before
your first request — every session, without you repeating yourself:

```markdown
- Antworte immer auf Deutsch, knapp.
- Dieses Projekt ist Node/ESM — keine TypeScript-Vorschläge.
- Vor jedem Commit `npm test` laufen lassen.
- API liegt in src/api/, Datenbank ist SQLite.
```

Another file, or none at all:

```bash
da --instructions ./regeln.txt
da config set instructionsFile "C:/Users/me/regeln.txt"
da --no-instructions          # ignore it for this run
```

API providers receive it inside the system prompt. `deepseek-web` has no system
prompt, so it sends the file as the **opening message of the new chat**, before the
project context and before your request. Capped at 20 000 characters.

---

## Usage

### Interactive chat
```bash
cd your-project/
da
```

DevAgent indexes your codebase, then opens a chat session:

```
da › explain the authentication flow
da › run the tests for src/api/users.ts
da › there's a bug in the login handler, fix it
da › stage all my changes and write a commit message
da › refactor the database module to use connection pooling
```

### One-shot (pipe-friendly)
```bash
da "what does this codebase do?"
da "run the linter and fix any errors"
da "generate a README based on the code"
```

### Skip indexing (for large repos or quick queries)
```bash
da --no-index "what Node version does this project need?"
```

---

## Slash commands (in chat)

| Command     | Description                        |
|-------------|------------------------------------|
| `/help`     | Show available commands            |
| `/clear`    | Clear conversation history         |
| `/index`    | Re-index the codebase              |
| `/context`  | Show codebase summary              |
| `/plugins`  | List loaded plugins                |
| `/exit`     | Exit DevAgent                      |

---

## CLI reference

```
da [prompt]              One-shot: ask a question and exit
da chat                  Start interactive chat (default)
da config <action>       Manage configuration
da plugin <action>       Manage plugins
da models [--all]        List available models (free ones by default)
da deepseek <action>     Key-free bridge: install-browser | login | status | test | logout
da index [dir]           Index a directory and show summary

Options:
  -k, --api-key KEY      API key for the active provider (overrides config)
  -m, --model MODEL      Model to use (default: claude-sonnet-4-6)
  -p, --provider NAME    deepseek-web | anthropic | deepseek | openrouter | openai
  -t, --think            Key-free DeepThink (same as -m deepseek-web-think)
  --base-url URL         Override the provider endpoint (self-hosted / proxy)
  --cwd DIR              Working directory
  --instructions FILE    Standing instructions (default: DEVAGENT.md)
  --no-instructions      Ignore the instructions file for this run
  --no-index             Skip codebase indexing
  --verbose              Debug output
  -v, --version          Show version
  -h, --help             Show help
```

### Providers & models

| Provider   | Example models                                   | Key field / env var                    |
|------------|--------------------------------------------------|----------------------------------------|
| deepseek-web | `deepseek-web`, `deepseek-web-think`           | **none — browser session**              |
| anthropic  | `claude-sonnet-4-6`, `claude-opus-4-6`           | `anthropicApiKey` / `ANTHROPIC_API_KEY` |
| deepseek   | `deepseek-chat`, `deepseek-reasoner`             | `deepseekApiKey` / `DEEPSEEK_API_KEY`   |
| openrouter | `deepseek/deepseek-chat-v3-0324:free`, `deepseek/deepseek-r1:free` | `openrouterApiKey` / `OPENROUTER_API_KEY` |
| openai     | `gpt-4o`, `gpt-4o-mini`                           | `openaiApiKey` / `OPENAI_API_KEY`       |

The provider is auto-detected from the model name; override it with `--provider`.

### Config
```bash
da config set api-key sk-ant-...
da config set model deepseek-chat
da config set provider deepseek     # optional; usually auto-detected
da config list
da config path                      # show config file location
```

---

## Plugins

DevAgent has a plugin system to add new tools. Plugins are single `.js` files that export a tool definition + handler.

### Install a plugin
```bash
# From a local file
da plugin add ./my-plugin.js

# From a URL
da plugin add https://example.com/my-plugin.js
```

### List / remove plugins
```bash
da plugin list
da plugin remove my-plugin
```

### Writing a plugin

```js
// my-plugin.js
export default {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Does something useful',

  tools: [
    {
      name: 'my_tool',
      description: 'What this tool does — Claude reads this to decide when to call it.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The query to process' },
        },
        required: ['query'],
      },

      // context: { workdir, ui, config }
      handler: async (input, context) => {
        const result = doSomething(input.query);
        return { ok: true, output: result };
      },
    },
  ],
};
```

Plugins are stored in `~/.devagent/plugins/`. See `src/plugins/http-plugin.example.js` for a full example.

---

## How it works

1. **Codebase indexing** — on startup, DevAgent walks your project directory and builds a file map. Key files (package.json, README, source files) are included verbatim in the model's context window.
2. **Agentic loop** — your message is sent to the model with the codebase context and a set of tools. The model decides which tools to call (run commands, read/write files), executes them, sees the results, and loops until the task is complete.
3. **Multi-turn memory** — conversation history is kept in memory for the session, so you can follow up naturally.

### Built-in tools

| Tool           | What it does                                      |
|----------------|---------------------------------------------------|
| `run_command`  | Execute any shell command in your project root    |
| `read_file`    | Read a file by relative path                      |
| `write_file`   | Write or overwrite a file                         |

---

## Requirements

- Node.js 18+
- An API key for at least one provider: [Anthropic](https://console.anthropic.com),
  [DeepSeek](https://platform.deepseek.com), or [OpenRouter](https://openrouter.ai)
  (the last two can be free — see [USEFREE.md](./USEFREE.md))

---

## License

MIT
