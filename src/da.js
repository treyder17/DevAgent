#!/usr/bin/env node
// DevAgent (da) — AI coding assistant for your terminal
// MIT License

import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import minimist from 'minimist';

import { Agent } from './core/agent.js';
import { CodebaseIndex } from './core/codebase.js';
import { PluginManager } from './core/plugins.js';
import { UI } from './ui/ui.js';
import { CONFIG } from './core/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = minimist(process.argv.slice(2), {
  boolean: ['help', 'version', 'no-index', 'verbose'],
  string: ['api-key', 'model', 'cwd'],
  alias: { h: 'help', v: 'version', k: 'api-key', m: 'model' },
});

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
  if (!config.apiKey) {
    ui.error('No API key found. Run: da config set api-key YOUR_KEY');
    process.exit(1);
  }

  const workdir = resolve(argv.cwd || process.cwd());
  ui.info(`Working directory: ${workdir}`);

  // Index codebase
  let codebaseIndex = null;
  if (!argv['no-index']) {
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

  rl.on('close', () => {
    ui.print('\nGoodbye!');
    process.exit(0);
  });
}

async function runOneShot(prompt, argv) {
  const ui = new UI({ quiet: true });
  const config = await CONFIG.load(argv);
  if (!config.apiKey) {
    ui.error('No API key found. Run: da config set api-key YOUR_KEY');
    process.exit(1);
  }

  const workdir = resolve(argv.cwd || process.cwd());
  const codebaseIndex = argv['no-index'] ? null : new CodebaseIndex(workdir);
  if (codebaseIndex) await codebaseIndex.build();

  const plugins = new PluginManager(config);
  await plugins.loadAll();

  const agent = new Agent({ config, codebaseIndex, plugins, workdir, ui });
  await agent.chat(prompt);
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
      const display = k.includes('key') ? v.slice(0, 8) + '…' : v;
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

function printHelp() {
  console.log(`
DevAgent (da) — AI coding assistant for your terminal

USAGE
  da [prompt]              One-shot: ask a question and exit
  da chat                  Start interactive chat session
  da config <action>       Manage configuration
  da plugin <action>       Manage plugins
  da index [dir]           Index a directory

OPTIONS
  -k, --api-key KEY        Anthropic API key (overrides config)
  -m, --model MODEL        Model to use (default: claude-sonnet-4-6)
  --cwd DIR                Working directory
  --no-index               Skip codebase indexing
  --verbose                Show debug output
  -v, --version            Show version
  -h, --help               Show this help

EXAMPLES
  da "explain the auth middleware"
  da "run tests for src/utils.js"
  da "commit my staged changes with a good message"
  da chat
  da config set api-key sk-ant-...
  da plugin add ./my-plugin.js

SLASH COMMANDS (in chat)
  /help      Show slash commands
  /clear     Clear conversation history
  /index     Re-index codebase
  /context   Show codebase summary
  /plugins   List loaded plugins
  /exit      Exit DevAgent
`);
}

function printSlashHelp(ui) {
  ui.print(`
Slash commands:
  /help      This help
  /clear     Clear conversation history
  /index     Re-index codebase
  /context   Show codebase summary
  /plugins   List loaded plugins
  /exit      Exit DevAgent
`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
