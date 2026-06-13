// src/core/plugins.js — plugin loader and registry

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve, extname, basename } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';

const PLUGINS_DIR = join(homedir(), '.devagent', 'plugins');

/**
 * Plugin shape (what a plugin file must export):
 *
 * export default {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   description: 'Does something useful',
 *   tools: [
 *     {
 *       // Anthropic tool definition (name, description, input_schema)
 *       name: 'my_tool',
 *       description: '...',
 *       input_schema: { ... },
 *       // Handler called by the agent
 *       handler: async (input, context) => {
 *         // context: { workdir, ui, config }
 *         return { ok: true, output: '...' };
 *       },
 *     }
 *   ]
 * }
 */

export class PluginManager {
  constructor(config) {
    this.config = config;
    this.pluginsDir = config.pluginsDir ?? PLUGINS_DIR;
    this._plugins = new Map(); // name → plugin module
  }

  get count() {
    return this._plugins.size;
  }

  get names() {
    return [...this._plugins.keys()];
  }

  /** All tool definitions across all plugins */
  get toolDefinitions() {
    const defs = [];
    for (const plugin of this._plugins.values()) {
      if (Array.isArray(plugin.tools)) {
        for (const tool of plugin.tools) {
          defs.push({
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
          });
        }
      }
    }
    return defs;
  }

  /** Find a handler for a tool name from any plugin */
  findHandler(toolName) {
    for (const plugin of this._plugins.values()) {
      if (Array.isArray(plugin.tools)) {
        const tool = plugin.tools.find(t => t.name === toolName);
        if (tool?.handler) return tool.handler;
      }
    }
    return null;
  }

  async loadAll() {
    if (!existsSync(this.pluginsDir)) return;

    const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!['.js', '.mjs'].includes(extname(entry.name))) continue;
      await this._load(join(this.pluginsDir, entry.name));
    }
  }

  async _load(filePath) {
    try {
      const mod = await import(pathToFileURL(filePath).href);
      const plugin = mod.default ?? mod;
      if (!plugin?.name) throw new Error('Plugin must export a `name`');
      this._plugins.set(plugin.name, plugin);
    } catch (err) {
      console.warn(`[DevAgent] Failed to load plugin ${filePath}: ${err.message}`);
    }
  }

  listInstalled() {
    const list = [];
    if (!existsSync(this.pluginsDir)) return list;
    const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = extname(entry.name);
      if (!['.js', '.mjs'].includes(ext)) continue;
      const fullPath = join(this.pluginsDir, entry.name);
      try {
        const src = readFileSync(fullPath, 'utf8');
        const nameMatch = src.match(/name:\s*['"]([^'"]+)['"]/);
        const descMatch = src.match(/description:\s*['"]([^'"]+)['"]/);
        list.push({
          name: nameMatch?.[1] ?? basename(entry.name, ext),
          description: descMatch?.[1] ?? '(no description)',
          file: entry.name,
        });
      } catch {
        list.push({ name: basename(entry.name, ext), description: '', file: entry.name });
      }
    }
    return list;
  }

  async install(source, ui) {
    mkdirSync(this.pluginsDir, { recursive: true });

    // Local file copy
    if (existsSync(source)) {
      const dest = join(this.pluginsDir, basename(source));
      const content = readFileSync(source, 'utf8');
      writeFileSync(dest, content);
      ui.success(`Plugin installed: ${basename(source)}`);
      return;
    }

    // URL download
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const spinner = ui.spinner(`Downloading plugin from ${source}…`);
      try {
        const { default: fetch } = await import('node-fetch');
        const res = await fetch(source);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const filename = basename(new URL(source).pathname) || 'plugin.js';
        const dest = join(this.pluginsDir, filename);
        writeFileSync(dest, text);
        spinner.succeed(`Plugin installed: ${filename}`);
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
      }
      return;
    }

    ui.error('Provide a local file path or a https:// URL.');
  }

  remove(name, ui) {
    if (!existsSync(this.pluginsDir)) { ui.error('No plugins installed.'); return; }
    const entries = readdirSync(this.pluginsDir);
    const match = entries.find(f => basename(f, extname(f)) === name || f === name);
    if (!match) { ui.error(`Plugin not found: ${name}`); return; }
    rmSync(join(this.pluginsDir, match));
    ui.success(`Plugin removed: ${match}`);
  }
}
