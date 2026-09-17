# 🆓 Use DevAgent for FREE with DeepSeek

DevAgent no longer depends on Puter. Instead it can talk to **any** provider —
including **DeepSeek**, whose models you can run **for free**.

There are three free/cheap ways to get DeepSeek:

| Path | Cost | Key needed | Best for |
|------|------|-----------|----------|
| **Browser bridge** (`deepseek-web`) | **free** | **none at all** | no signup beyond a free DeepSeek login |
| **OpenRouter** | **100% free** models (`:free` tag) | free OpenRouter key | zero-cost API usage |
| **DeepSeek official API** | very cheap (pennies), small free credit | DeepSeek key | best quality / speed |

---

## 🚀 Option Zero — no API key whatsoever

DevAgent can use the free web chat at [chat.deepseek.com](https://chat.deepseek.com)
directly. It opens the site in a Chrome profile of its own, types your prompts into the
real chat, flips the **DeepThink** toggle when you ask for R1, and reads the answer back.

```bash
da deepseek login                        # sign in once in the Chrome window
da -m deepseek-web "explain this repo"   # DeepSeek-V3
da --think "why does this test flake?"   # DeepSeek-R1, DeepThink on
da config set model deepseek-web-think   # make DeepThink the default
```

| Model | What it is |
|-------|------------|
| `deepseek-web` | DeepSeek-V3, DeepThink off |
| `deepseek-web-think` | DeepSeek-R1, DeepThink on |

**How tools still work.** A web chat has no function-calling API, so DevAgent teaches the
model a text protocol instead: the system prompt documents every tool, the model answers
with one line

```
<<<TOOL>>>{"tool":"read_file","input":{"path":"src/da.js"}}<<<END>>>
```

and DevAgent runs it and feeds the output back as a `<<<RESULT>>>` message. File edits and
shell commands work exactly like with the API providers.

**Housekeeping**

```bash
da deepseek status           # profile, browser, port
da deepseek test             # one round trip through the bridge
da deepseek install-browser  # isolated Chrome (managed machines, see below)
da deepseek logout --force   # forget the stored session
```

**If no debugging port opens:** an already-running Chrome — or a managed `UserDataDir`
policy — swallows the new window. Close every Chrome window and retry, or run
`da deepseek install-browser` once. That fetches a standalone *Chrome for Testing* build
into `~/.devagent/browsers` which ignores enterprise policies and runs next to your
normal Chrome.

**Trade-offs:** it is as fast as the web UI (R1 thinks for a while), it obeys DeepSeek's
normal rate limits, and it automates your own account in your own browser — so keep it to
personal use.

---

## ✅ Option A — Free DeepSeek via OpenRouter (recommended)

OpenRouter hosts DeepSeek's models with a **free tier** — you pay nothing.

### 1. Get a free OpenRouter API key
1. Sign up at [openrouter.ai](https://openrouter.ai).
2. Go to **Keys → Create Key** and copy it (`sk-or-...`).

### 2. Store the key and pick a free model

```bash
da config set openrouterApiKey sk-or-YOUR_KEY
da config set model openai/gpt-oss-20b:free
```

The `:free` suffix is what makes it cost nothing.

> ⚠️ **Which models are free changes over time.** OpenRouter regularly rotates
> its free tier — DeepSeek's `:free` variants in particular come and go, and are
> sometimes moved to paid-only. Don't hardcode a model name from a guide; list
> what's *currently* free yourself:
>
> ```bash
> da models          # shows all free models; ✓ = supports tools
> da models --all    # everything, including paid
> ```
>
> Then pick one:
>
> ```bash
> da config set model <one-of-those>
> ```
>
> If DeepSeek shows up free there, great — use it. If not, any free tool-capable
> model (✓) works, or use the official DeepSeek API below.

> ℹ️ Tool-calling (file edits, running commands) needs a model that supports
> function calling. Reasoning-only models sometimes don't. If the agent stops
> using tools, switch to a chat/instruct model.

### 3. Run it 🚀

```bash
da
```

Or without changing your config, just for one session:

```bash
da --provider openrouter -m deepseek/deepseek-chat-v3-0324:free
```

---

## 💸 Option B — DeepSeek official API (cheap, top quality)

### 1. Get a DeepSeek key
1. Sign up at [platform.deepseek.com](https://platform.deepseek.com).
2. Create an API key (`sk-...`). New accounts get free credit to start.

### 2. Configure DevAgent

```bash
da config set deepseekApiKey sk-YOUR_KEY
da config set model deepseek-chat
```

Available models:
- `deepseek-chat` — DeepSeek-V3, fast, supports tools (recommended)
- `deepseek-reasoner` — DeepSeek-R1, deep reasoning

### 3. Run it 🚀

```bash
da
```

---

## 🔁 Switching between providers

DevAgent auto-detects the provider from the model name, so usually you only set
the model:

```bash
da config set model claude-sonnet-4-6                       # -> Anthropic
da config set model deepseek-chat                           # -> DeepSeek
da config set model deepseek/deepseek-r1:free               # -> OpenRouter
```

You can also force it explicitly with `--provider` / `-p`, and override the
endpoint with `--base-url` (e.g. a local OpenAI-compatible server):

```bash
da -p openai --base-url http://localhost:11434/v1 -m qwen2.5-coder
```

Each provider has its own stored key (`anthropicApiKey`, `deepseekApiKey`,
`openrouterApiKey`, `openaiApiKey`), or you can use the matching env var
(`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`).

---

## 💡 Pro Tip

To avoid setting the key every session, either store it in DevAgent's config
(commands above, saved in `~/.devagent/config.json`) or export the env var
permanently in your `~/.zshrc` / `~/.bashrc`:

```bash
export OPENROUTER_API_KEY="sk-or-YOUR_KEY"
```
