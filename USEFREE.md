# 🆓 Use DevAgent for FREE with DeepSeek

DevAgent no longer depends on Puter. Instead it can talk to **any** provider —
including **DeepSeek**, whose models you can run **for free**.

There are two free/cheap ways to get DeepSeek:

| Path | Cost | Key needed | Best for |
|------|------|-----------|----------|
| **OpenRouter** (recommended) | **100% free** models (`:free` tag) | free OpenRouter key | zero-cost usage |
| **DeepSeek official API** | very cheap (pennies), small free credit | DeepSeek key | best quality / speed |

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
> what's *currently* free (and supports tools) yourself:
>
> ```bash
> curl -s https://openrouter.ai/api/v1/models \
>   -H "Authorization: Bearer $OPENROUTER_API_KEY" \
> | python3 -c 'import sys,json; \
> [print(m["id"]) for m in json.load(sys.stdin)["data"] \
> if m["pricing"]["prompt"]=="0" and "tools" in m.get("supported_parameters",[])]'
> ```
>
> Then `da config set model <one-of-those>`. If DeepSeek shows up free there,
> great — use it. If not, any free tool-capable model works, or use the official
> DeepSeek API below.

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
