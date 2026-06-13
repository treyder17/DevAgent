# DevAgent (`da`)

> AI coding assistant for your terminal — codebase-aware, agent-powered.

DevAgent gives you a Claude-powered assistant that understands your entire project and can take real actions: run tests, write code, manage git, and more — all from a single `da` command.

---

## Install

### macOS / Linux
```bash
curl -fsSL https://raw.githubusercontent.com/your-repo/devagent/main/scripts/install.sh | bash
```

### Windows (PowerShell)
```powershell
iwr -useb https://raw.githubusercontent.com/your-repo/devagent/main/scripts/install.ps1 | iex
```

### Manual (any platform with Node.js 18+)
```bash
git clone https://github.com/your-repo/devagent.git ~/.devagent/src
cd ~/.devagent/src && npm install
# Add to PATH: alias da="node ~/.devagent/src/src/da.js"
```

---

## Setup

```bash
da config set api-key sk-ant-...
```

Get a key at [console.anthropic.com](https://console.anthropic.com).

You can also set `ANTHROPIC_API_KEY` in your environment — `da` will pick it up automatically.

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
da index [dir]           Index a directory and show summary

Options:
  -k, --api-key KEY      Anthropic API key (overrides config)
  -m, --model MODEL      Model to use (default: claude-sonnet-4-6)
  --cwd DIR              Working directory
  --no-index             Skip codebase indexing
  --verbose              Debug output
  -v, --version          Show version
  -h, --help             Show help
```

### Config
```bash
da config set api-key sk-ant-...
da config set model claude-opus-4-6
da config list
da config path            # show config file location
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

1. **Codebase indexing** — on startup, DevAgent walks your project directory and builds a file map. Key files (package.json, README, source files) are included verbatim in Claude's context window.
2. **Agentic loop** — your message is sent to Claude with the codebase context and a set of tools. Claude decides which tools to call (run commands, read/write files), executes them, sees the results, and loops until the task is complete.
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
- An [Anthropic API key](https://console.anthropic.com)

---

## License

MIT
