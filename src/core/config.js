// src/core/config.js — persistent config in ~/.devagent/config.json

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { PROVIDERS, detectProvider } from './providers.js';

const CONFIG_DIR = join(homedir(), '.devagent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  provider: '',            // '' = auto-detect from the model name
  model: 'claude-sonnet-4-6',
  baseUrl: '',             // optional override for the provider endpoint
  maxTokens: 8192,
  maxFileSizeKb: 100,
  maxIndexFiles: 2000,
  pluginsDir: join(CONFIG_DIR, 'plugins'),

  // Browser bridge for the key-free deepseek-web provider
  chromePath: null,                          // '' = auto-detect
  deepseekProfile: join(CONFIG_DIR, 'chrome-profile'),
  deepseekPort: 9222,
  deepseekHeadless: false,
  deepseekStabilityMs: 2500,                 // silence that counts as "answer done"
  deepseekMaxPrimerChars: 24000,             // cap on the codebase context in turn 1
  deepseekFirstTokenTimeout: 180000,         // R1 can think for a while
  deepseekTimeout: 600000,
  ignorePatterns: [
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
    '__pycache__', '.pytest_cache', 'venv', '.venv', 'env',
    '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    '*.min.js', '*.min.css', '*.map',
  ],
};

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

function getAll() {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function set(key, value) {
  ensureDir();
  const cfg = getAll();
  cfg[key] = value;
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function configPath() {
  return CONFIG_FILE;
}

async function load(argv) {
  const cfg = getAll();

  // CLI flags override config file
  if (argv['api-key']) cfg.apiKey = argv['api-key'];
  if (argv.model) cfg.model = argv.model;
  if (argv.provider) cfg.provider = argv.provider;
  if (argv['base-url']) cfg.baseUrl = argv['base-url'];
  if (argv.verbose) cfg.verbose = true;

  // Resolve which provider we're talking to (explicit wins, else guess from model).
  cfg.provider = cfg.provider || detectProvider(cfg.model);
  const preset = PROVIDERS[cfg.provider];
  if (!preset) {
    throw new Error(
      `Unknown provider "${cfg.provider}". Known: ${Object.keys(PROVIDERS).join(', ')}.`
    );
  }

  // Resolve the API key, in priority order:
  //   1. --api-key flag (already set above)
  //   2. provider-specific stored key, e.g. deepseekApiKey
  //   3. generic stored apiKey
  //   4. provider-specific env var, e.g. DEEPSEEK_API_KEY
  // Keyless providers (browser bridges) skip this entirely.
  if (!preset.keyless) {
    const providerKeyField = `${cfg.provider}ApiKey`;
    if (!cfg.apiKey && cfg[providerKeyField]) cfg.apiKey = cfg[providerKeyField];
    if (!cfg.apiKey) cfg.apiKey = process.env[preset.envKey];
  }
  cfg.keyless = !!preset.keyless;

  return cfg;
}

export const CONFIG = { load, set, getAll, configPath, DEFAULTS };
