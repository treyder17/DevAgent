// src/core/config.js — persistent config in ~/.devagent/config.json

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.devagent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  model: 'claude-sonnet-4-6',
  maxTokens: 8192,
  maxFileSizeKb: 100,
  maxIndexFiles: 2000,
  pluginsDir: join(CONFIG_DIR, 'plugins'),
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
  if (argv.verbose) cfg.verbose = true;

  // Fall back to env var
  if (!cfg.apiKey) cfg.apiKey = process.env.ANTHROPIC_API_KEY;

  return cfg;
}

export const CONFIG = { load, set, getAll, configPath, DEFAULTS };
