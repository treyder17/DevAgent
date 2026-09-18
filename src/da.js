#!/usr/bin/env node
// DevAgent (da) — AI coding assistant for your terminal
// MIT License

import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import minimist from 'minimist';

import { Agent } from './core/agent.js';
import { CodebaseIndex } from './core/codebase.js';
import { PluginManager } from './core/plugins.js';
import { UI } from './ui/ui.js';
import { CONFIG } from './core/config.js';
import { PROVIDERS, createProvider } from './core/providers.js';
import { DeepSeekWebProvider, resolveWebModel } from './core/deepseek-web.js';
import {
  getBrowser, getPage, defaultProfileDir, findChrome,
  browsersDir, managedFreeChrome, chromeRunning, profilePolicyActive,
} from './core/browser.js';

function missingKeyMessage(provider) {
  const preset = PROVIDERS[provider];
  const envKey = preset?.envKey ?? 'ANTHROPIC_API_KEY';
  return `No API key found for provider "${provider}".\n` +
    `  Set it with:  da config set ${provider}ApiKey YOUR_KEY\n` +
    `  Or via env:   export ${envKey}="YOUR_KEY"`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = minimist(process.argv.slice(2), {
  boolean: ['help', 'version', 'no-index', 'verbose', 'think', 'force', 'no-instructions'],
  string: ['api-key', 'model', 'cwd', 'provider', 'base-url', 'instructions'],
  alias: { h: 'help', v: 'version', k: 'api-key', m: 'model', p: 'provider', t: 'think' },
});

// --think is a shortcut for the key-free DeepThink model.
if (argv.think && !argv.model) argv.model = 'deepseek-web-think';

// minimist turns `--no-x` into `x === false`, not `argv['no-x'] === true`,
// so both spellings have to be accepted or the flag silently does nothing.
const isOff = (name) => argv[`no-${name}`] === true || argv[name] === false;
argv.skipIndex = isOff('index');

async function main() {
  if (argv.version) {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
    console.log(`DevAgent v${pkg.version}`);
    process.exit(0);
  }

  if (argv.help) {
    printHelp();
    process.exit(0);
  }

  // Sub-commands
  const [cmd, ...args] = argv._;

  if (cmd === 'config') {
    await handleConfig(args);
    return;
  }

  if (cmd === 'plugin') {
    await handlePlugin(args);
    return;
  }

  if (cmd === 'index') {
    await handleIndex(args);
    return;
  }

  if (cmd === 'models') {
    await handleModels(args, argv);
    return;
  }

  if (cmd === 'deepseek') {
    await handleDeepSeek(args);
    return;
  }

  // One-shot mode: da "explain this function"
  if (cmd && cmd !== 'chat') {
    const prompt = [cmd, ...args].join(' ');
    await runOneShot(prompt, argv);
    return;
  }

  // Interactive chat mode (default)
  await runChat(argv);
}

async function runChat(argv) {
  const ui = new UI();
  ui.banner();

  const config = await CONFIG.load(argv);
  if (!config.apiKey && !config.keyless) {
    ui.error(missingKeyMessage(config.provider));
    process.exit(1);
  }
  config.ui = ui;

  const workdir = resolve(argv.cwd || process.cwd());
  ui.info(`Working directory: ${workdir}`);
  ui.info(`Provider: ${config.provider} · Model: ${config.model}`);

  // Index codebase
  let codebaseIndex = null;
  if (!argv.skipIndex) {
    const spinner = ui.spinner('Indexing codebase…');
    codebaseIndex = new CodebaseIndex(workdir);
    await codebaseIndex.build();
    spinner.succeed(`Indexed ${codebaseIndex.fileCount} files`);
  }

  // Load plugins
  const plugins = new PluginManager(config);
  await plugins.loadAll();
  if (plugins.count > 0) {
    ui.info(`Loaded ${plugins.count} plugin(s): ${plugins.names.join(', ')}`);
  }

  const agent = new Agent({ config, codebaseIndex, plugins, workdir, ui });

  ui.print('');
  ui.print('Type your request, or /help for commands. Ctrl+C to exit.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ui.promptStr(),
    terminal: true,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // Slash commands
    if (input.startsWith('/')) {
      await handleSlashCommand(input, agent, ui, rl);
      rl.prompt();
      return;
    }

    try {
      await agent.chat(input);
    } catch (err) {
      ui.error(err.message);
    }
    rl.prompt();
  });

  rl.on('close', async () => {
    await agent.dispose();
    ui.print('\nGoodbye!');
    process.exit(0);
  });
}

async function runOneShot(prompt, argv) {
  const ui = new UI({ quiet: true });
  const config = await CONFIG.load(argv);
  if (!config.apiKey && !config.keyless) {
    ui.error(missingKeyMessage(config.provider));
    process.exit(1);
  }
  config.ui = ui;

  const workdir = resolve(argv.cwd || process.cwd());
  const codebaseIndex = argv.skipIndex ? null : new CodebaseIndex(workdir);
  if (codebaseIndex) await codebaseIndex.build();

  const plugins = new PluginManager(config);
  await plugins.loadAll();

  const agent = new Agent({ config, codebaseIndex, plugins, workdir, ui });
  try {
    await agent.chat(prompt);
  } finally {
    await agent.dispose();
  }
}

async function handleSlashCommand(input, agent, ui, rl) {
  const [cmd, ...args] = input.slice(1).split(' ');
  switch (cmd.toLowerCase()) {
    case 'help':
      printSlashHelp(ui);
      break;
    case 'clear':
      agent.clearHistory();
      ui.success('Conversation history cleared.');
      break;
    case 'index':
      const spinner = ui.spinner('Re-indexing codebase…');
      await agent.codebaseIndex?.build();
      spinner.succeed(`Indexed ${agent.codebaseIndex?.fileCount ?? 0} files`);
      break;
    case 'context':
      const summary = agent.codebaseIndex?.summary() ?? 'No index loaded.';
      ui.print(summary);
      break;
    case 'plugins':
      const names = agent.plugins?.names ?? [];
      ui.print(names.length ? `Plugins: ${names.join(', ')}` : 'No plugins loaded.');
      break;
    case 'models': {
      const sp = ui.spinner('Fetching models…');
      try {
        const models = await agent.listModels();
        const anyPricing = models.some(m => m.hasPricing);
        const showAll = args.includes('--all');
        const free = models.filter(m => m.free);
        sp.succeed(`${models.length} models` + (anyPricing ? ` · ${free.length} free` : ''));
        const list = (anyPricing && !showAll ? free : models)
          .sort((a, b) => a.id.localeCompare(b.id));
        list.forEach(m => ui.print(`  ${m.tools ? '✓' : ' '}  ${m.id}`));
        ui.print(`\nSwitch with:  /model <id>`);
      } catch (err) {
        sp.fail(`Could not list models: ${err.message}`);
      }
      break;
    }
    case 'model': {
      const id = args[0];
      if (!id) {
        ui.print(`Current model: ${agent.config.model} (provider: ${agent.config.provider})`);
        ui.print('Switch with: /model <id> — list options with /models');
        break;
      }
      const { warning } = agent.setModel(id);
      CONFIG.set('model', id);
      ui.success(`Model switched to: ${id}`);
      if (warning) ui.warn(warning);
      break;
    }
    case 'exit':
    case 'quit':
      ui.print('Goodbye!');
      process.exit(0);
    default:
      ui.error(`Unknown command: /${cmd}. Type /help for a list.`);
  }
}

async function handleConfig(args) {
  const ui = new UI();
  const [action, key, ...valueParts] = args;
  const value = valueParts.join(' ');

  if (action === 'set' && key && value) {
    CONFIG.set(key, value);
    ui.success(`Config updated: ${key}`);
  } else if (action === 'get' && key) {
    const cfg = CONFIG.getAll();
    ui.print(cfg[key] ?? '(not set)');
  } else if (action === 'list' || action === 'show') {
    const cfg = CONFIG.getAll();
    for (const [k, v] of Object.entries(cfg)) {
      const isSecret = /key/i.test(k);
      const display = isSecret && typeof v === 'string' && v
        ? v.slice(0, 8) + '…'
        : JSON.stringify(v);
      ui.print(`  ${k} = ${display}`);
    }
  } else if (action === 'path') {
    ui.print(CONFIG.configPath());
  } else {
    ui.print('Usage: da config <set|get|list|path> [key] [value]');
  }
}

async function handlePlugin(args) {
  const ui = new UI();
  const [action, ...rest] = args;
  const config = await CONFIG.load({});
  const plugins = new PluginManager(config);

  if (action === 'list') {
    const list = plugins.listInstalled();
    if (list.length === 0) {
      ui.print('No plugins installed. Add a plugin with: da plugin add <path-or-url>');
    } else {
      list.forEach(p => ui.print(`  • ${p.name} — ${p.description}`));
    }
  } else if (action === 'add' && rest[0]) {
    await plugins.install(rest[0], ui);
  } else if (action === 'remove' && rest[0]) {
    await plugins.remove(rest[0], ui);
  } else {
    ui.print('Usage: da plugin <list|add|remove> [name-or-path]');
  }
}

async function handleIndex(args) {
  const ui = new UI();
  const workdir = resolve(args[0] || process.cwd());
  const spinner = ui.spinner(`Indexing ${workdir}…`);
  const index = new CodebaseIndex(workdir);
  await index.build();
  spinner.succeed(`Indexed ${index.fileCount} files`);
  ui.print(index.summary());
}

async function handleModels(args, argv) {
  const ui = new UI();
  const config = await CONFIG.load(argv);
  if (!config.apiKey && !config.keyless) {
    ui.error(missingKeyMessage(config.provider));
    process.exit(1);
  }

  const showAll = args.includes('--all') || args.includes('-a');
  const spinner = ui.spinner(`Fetching models from ${config.provider}…`);

  let models;
  try {
    const provider = createProvider(config);
    models = await provider.listModels();
  } catch (err) {
    spinner.fail(`Could not list models: ${err.message}`);
    process.exit(1);
  }

  const anyPricing = models.some(m => m.hasPricing);
  const free = models.filter(m => m.free);
  spinner.succeed(
    `${config.provider}: ${models.length} models` +
    (anyPricing ? ` · ${free.length} free` : '')
  );

  // For providers that expose pricing (OpenRouter), default to showing free
  // models only — that's "all free models". Use --all to see everything.
  const shouldFilterFree = anyPricing && !showAll;
  const list = (shouldFilterFree ? free : models).sort((a, b) => a.id.localeCompare(b.id));

  if (shouldFilterFree) {
    ui.print(`\nFree models (✓ = supports tools — needed for file/command actions):\n`);
  } else {
    ui.print('');
  }

  for (const m of list) {
    const toolMark = m.tools ? '✓' : ' ';
    const freeTag = (anyPricing && !shouldFilterFree && m.free) ? '  [free]' : '';
    ui.print(`  ${toolMark}  ${m.id}${freeTag}`);
  }

  ui.print(`\nUse one with:  da config set model <id>   (or per session:  da -m <id>)`);
  if (shouldFilterFree) ui.print(`See every model (incl. paid) with:  da models --all`);
}

// ---- DeepSeek web bridge (no API key) ------------------------------------

async function handleDeepSeek(args) {
  const ui = new UI();
  const [action = 'status'] = args;
  const config = await CONFIG.load({ ...argv, provider: 'deepseek-web' });
  const profileDir = config.deepseekProfile || defaultProfileDir();
  const port = Number(config.deepseekPort) || 9222;

  if (action === 'install-browser') {
    const { install, resolveBuildId, computeExecutablePath, detectBrowserPlatform, Browser } =
      await import('@puppeteer/browsers');
    const cacheDir = browsersDir();
    const spinner = ui.spinner('Resolving Chrome for Testing…');
    try {
      const platform = detectBrowserPlatform();
      const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
      spinner.text = `Downloading Chrome for Testing ${buildId} (~150 MB)…`;
      await install({ browser: Browser.CHROME, buildId, cacheDir });
      const exe = computeExecutablePath({ browser: Browser.CHROME, buildId, cacheDir, platform });
      CONFIG.set('chromePath', exe);
      spinner.succeed(`Installed: ${exe}`);
      ui.success('Saved as chromePath — this build ignores enterprise policies.');
      ui.print('Next:  da deepseek login');
    } catch (err) {
      spinner.fail(`Download failed: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === 'login') {
    if (!findChrome(config.chromePath)) {
      ui.error('Chrome not found. Install it, or run: da deepseek install-browser');
      process.exit(1);
    }
    ui.info(`Opening chat.deepseek.com · profile: ${profileDir}`);
    let browser;
    try {
      ({ browser } = await getBrowser({
        port,
        profileDir,
        headless: false,
        chromePath: config.chromePath || null,
        startUrl: 'https://chat.deepseek.com/',
      }));
    } catch (err) {
      ui.error(err.message);
      process.exit(1);
    }
    const page = await getPage(browser, /chat\.deepseek\.com/, 'https://chat.deepseek.com/');

    ui.print('');
    ui.print('Sign in in the Chrome window — a free DeepSeek account is enough, no API key.');
    ui.print('Waiting for the chat input to appear…  (Ctrl+C to abort)');

    const deadline = Date.now() + 5 * 60 * 1000;
    let ok = false;
    while (Date.now() < deadline) {
      ok = await page.evaluate(() => !!document.querySelector('#chat-input, textarea')).catch(() => false);
      if (ok) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    await browser.disconnect();

    if (ok) {
      ui.success('Logged in — the session is stored in the profile.');
      ui.print('Try it:  da -m deepseek-web "hello"   ·   da --think "hello"');
    } else {
      ui.warn('No logged-in chat detected within 5 minutes. Leave Chrome open and retry.');
    }
    return;
  }

  if (action === 'status') {
    const hasProfile = existsSync(join(profileDir, 'Default', 'Preferences'));
    ui.print(`Profile:  ${profileDir}`);
    ui.print(`Session:  ${hasProfile ? 'stored' : 'none — run: da deepseek login'}`);
    ui.print(`Chrome:   ${findChrome(config.chromePath) || '(not found)'}`);
    ui.print(`Isolated: ${managedFreeChrome() || 'no — run: da deepseek install-browser'}`);
    ui.print(`Port:     ${port}`);
    ui.print(`Headless: ${config.deepseekHeadless === true || config.deepseekHeadless === 'true'}`);
    if (profilePolicyActive()) {
      ui.warn('A Chrome policy pins the profile directory — use the isolated browser, or close all Chrome windows first.');
    } else if (chromeRunning() && !managedFreeChrome()) {
      ui.warn('Chrome is running — close it before "da deepseek login", or install the isolated browser.');
    }
    return;
  }

  if (action === 'test') {
    const model = resolveWebModel(argv.model) || (argv.think ? 'deepseek-web-think' : 'deepseek-web');
    const provider = new DeepSeekWebProvider({ model, config, ui });
    const spinner = ui.spinner(`Asking ${provider.label}…`);
    try {
      await provider.init();
      const reply = await provider._send('Reply with exactly: DevAgent bridge OK');
      spinner.succeed('Round trip complete');
      ui.assistantMessage(reply);
    } catch (err) {
      spinner.fail(err.message);
      process.exitCode = 1;
    } finally {
      await provider.close();
    }
    return;
  }

  if (action === 'logout') {
    if (!argv.force) {
      ui.print(`This deletes the browser profile at:
  ${profileDir}`);
      ui.print('Confirm with:  da deepseek logout --force');
      return;
    }
    rmSync(profileDir, { recursive: true, force: true });
    ui.success('DeepSeek browser session removed.');
    return;
  }

  ui.print('Usage: da deepseek <install-browser|login|status|test|logout>');
}

function printHelp() {
  console.log(`
DevAgent (da) — AI coding assistant for your terminal

USAGE
  da [prompt]              One-shot: ask a question and exit
  da chat                  Start interactive chat session
  da config <action>       Manage configuration
  da plugin <action>       Manage plugins
  da models [--all]        List available models (free ones by default)
  da deepseek <action>     Key-free DeepSeek bridge:
                           install-browser | login | status | test | logout
  da index [dir]           Index a directory

OPTIONS
  -k, --api-key KEY        API key for the active provider (overrides config)
  -m, --model MODEL        Model to use (default: claude-sonnet-4-6)
  -p, --provider NAME      Provider: deepseek-web | anthropic | deepseek |
                           openrouter | openai (default: from the model name)
  -t, --think              Key-free DeepThink (same as -m deepseek-web-think)
  --base-url URL           Override the provider endpoint (self-hosted / proxy)
  --cwd DIR                Working directory
  --instructions FILE      Standing instructions to send before your first
                           request (default: DEVAGENT.md in the working dir)
  --no-instructions        Ignore the instructions file for this run
  --no-index               Skip codebase indexing
  --verbose                Show debug output
  -v, --version            Show version
  -h, --help               Show this help

PROVIDERS & MODELS
  deepseek-web  deepseek-web, deepseek-web-think           (NO KEY — browser)
  anthropic   claude-sonnet-4-6, claude-opus-4-6, …        (ANTHROPIC_API_KEY)
  deepseek    deepseek-chat, deepseek-reasoner             (DEEPSEEK_API_KEY)
  openrouter  deepseek/deepseek-chat-v3-0324:free, …       (OPENROUTER_API_KEY)
  openai      gpt-4o, gpt-4o-mini, …                       (OPENAI_API_KEY)
  The provider is auto-detected from the model name, or set it explicitly.

NO API KEY? START HERE
  da deepseek login                       sign in once to the free web chat
  da -m deepseek-web "explain this repo"  DeepSeek-V3, no key, no billing
  da --think "why does this test flake?"  DeepSeek-R1 with DeepThink on

EXAMPLES
  da "explain the auth middleware"
  da "run tests for src/utils.js" -m deepseek-chat
  da chat --provider openrouter -m deepseek/deepseek-r1:free
  da config set api-key sk-ant-...
  da config set deepseekApiKey sk-...
  da config set model deepseek-chat
  da plugin add ./my-plugin.js

SLASH COMMANDS (in chat)
  /help      Show slash commands
  /clear     Clear conversation history
  /models    List available models (free ones by default)
  /model     Show or switch the active model
  /index     Re-index codebase
  /context   Show codebase summary
  /plugins   List loaded plugins
  /exit      Exit DevAgent
`);
}

function printSlashHelp(ui) {
  ui.print(`
Slash commands:
  /help          This help
  /clear         Clear conversation history
  /models [--all] List available models (free ones by default)
  /model [id]    Show or switch the active model
  /index         Re-index codebase
  /context       Show codebase summary
  /plugins       List loaded plugins
  /exit          Exit DevAgent
`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
