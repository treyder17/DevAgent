// src/core/agent.js — provider-agnostic agentic loop with tool use

import { TOOL_DEFINITIONS, runShell, readFile, writeFile, fetchUrl, webSearch } from '../tools/builtin.js';
import { createProvider, detectProvider } from './providers.js';
import { loadInstructions } from './instructions.js';

const MAX_ITERATIONS = 20; // safety limit for the tool loop

export class Agent {
  constructor({ config, codebaseIndex, plugins, workdir, ui }) {
    this.config = config;
    this.codebaseIndex = codebaseIndex;
    this.plugins = plugins;
    this.workdir = workdir;
    this.ui = ui;
    this.history = []; // provider-neutral multi-turn conversation history

    this._provider = createProvider(config);
    // Standing instructions: a chat UI gets them as its own opening message,
    // an API provider gets them inside the system prompt. Never both.
    this.instructions = loadInstructions(config, workdir, ui);
    this._systemPrompt = this._buildSystemPrompt();
  }

  clearHistory() {
    this.history = [];
  }

  /**
   * Release provider resources. Browser-backed providers hold an open
   * DevTools socket, which keeps the Node event loop alive after the last
   * answer — without this, `da "…"` prints its result and never exits.
   */
  async dispose() {
    await this._provider?.close?.();
  }

  /** List models available from the current provider. */
  async listModels() {
    return this._provider.listModels();
  }

  /**
   * Switch the active model within the current provider and rebuild the client.
   * Returns { ok, warning } — warning is set when the model looks like it
   * belongs to a different provider (use `da config` for cross-provider switches).
   */
  setModel(model) {
    this.config.model = model;
    this._provider = createProvider(this.config);
    this._systemPrompt = this._buildSystemPrompt();
    const guessed = detectProvider(model);
    const warning = guessed !== this.config.provider
      ? `Model "${model}" looks like a "${guessed}" model, but the active provider is "${this.config.provider}". `
        + `If it fails, set it up with: da config set model ${model}`
      : null;
    return { ok: true, warning };
  }

  /** Instructions belong in the system prompt unless the provider sends them itself. */
  get _inlineInstructions() {
    return this.instructions && !this._provider?.separateInstructions
      ? `
## Project instructions (from ${this.instructions.path})
${this.instructions.text}
`
      : '';
  }

  _buildSystemPrompt() {
    const codebaseCtx = this.codebaseIndex?.buildSystemContext() ?? '';

    return `You are DevAgent, an expert AI coding assistant embedded in the developer's terminal.
You have full awareness of the user's codebase and can take actions by calling tools.

## Your capabilities
- Read and write files in the project
- Run shell commands (tests, builds, linters, git, package managers, etc.)
- Understand the entire codebase structure

## Personality & style
- Be concise in prose. Don't over-explain unless asked.
- Prefer action over lengthy explanation: if the user says "run the tests", run them.
- When running commands, briefly state what you're doing and show output.
- When writing files, show the key changes made.
- For git commits: write conventional commit messages (feat/fix/chore/docs/refactor/test).
- Never make up file contents you haven't read; use read_file first if unsure.

## Safety rules
- Never run destructive commands (rm -rf on important dirs, DROP TABLE, etc.) without explicitly telling the user what it does and waiting for their message to confirm.
- Do not expose API keys or secrets in output.
- Prefer dry-run or --check flags first for risky operations.

## Working directory
${this.workdir}
${this._inlineInstructions}
${codebaseCtx}
`;
  }

  /** All tool definitions: built-in + plugin tools */
  _allTools() {
    return [
      ...TOOL_DEFINITIONS,
      ...(this.plugins?.toolDefinitions ?? []),
    ];
  }

  /** Execute a tool call and return the result string */
  async _executeTool(toolName, toolInput) {
    // Plugin tool?
    const pluginHandler = this.plugins?.findHandler(toolName);
    if (pluginHandler) {
      const ctx = { workdir: this.workdir, ui: this.ui, config: this.config };
      try {
        const result = await pluginHandler(toolInput, ctx);
        return result?.output ?? JSON.stringify(result);
      } catch (err) {
        return `Plugin error: ${err.message}`;
      }
    }

    // Built-in tools
    switch (toolName) {
      case 'run_command': {
        const { command, explanation } = toolInput;
        this.ui.toolCall('run_command', explanation || command);
        const result = runShell(command, this.workdir);
        let out = '';
        if (result.stdout) out += result.stdout;
        if (result.stderr) out += (out ? '\n' : '') + '[stderr] ' + result.stderr;
        if (!out) out = result.ok ? '(command completed successfully)' : `(exit code ${result.exitCode})`;
        this.ui.toolResult(out, result.ok);
        return out;
      }

      case 'read_file': {
        const { path } = toolInput;
        this.ui.toolCall('read_file', path);
        const result = readFile(path, this.workdir);
        if (!result.ok) return `Error: ${result.error}`;
        this.ui.toolResult(`Read ${path} (${result.content.length} chars)`, true);
        return result.content;
      }

      case 'write_file': {
        const { path, content, explanation } = toolInput;
        this.ui.toolCall('write_file', `${path} — ${explanation || ''}`);
        const result = writeFile(path, content, this.workdir);
        if (!result.ok) return `Error: ${result.error}`;
        this.ui.toolResult(`Written: ${path}`, true);
        return `File written successfully: ${path}`;
      }

      case 'web_fetch': {
        const { url } = toolInput;
        this.ui.toolCall('web_fetch', url);
        const r = await fetchUrl(url);
        if (!r.ok && r.error) { this.ui.toolResult(`Error: ${r.error}`, false); return `Error fetching ${url}: ${r.error}`; }
        this.ui.toolResult(`Fetched ${r.url} (HTTP ${r.status}, ${r.text.length} chars${r.truncated ? ', truncated' : ''})`, r.ok);
        return `URL: ${r.url}
HTTP ${r.status}

${r.text}`;
      }

      case 'web_search': {
        const { query } = toolInput;
        this.ui.toolCall('web_search', query);
        const r = await webSearch(query);
        if (!r.ok) { this.ui.toolResult(`Error: ${r.error}`, false); return `Search failed: ${r.error}`; }
        if (!r.results.length) { this.ui.toolResult('no results', false); return 'No results.'; }
        this.ui.toolResult(`${r.results.length} results`, true);
        return r.results
          .map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`)
          .join('\n\n');
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  /** Main chat entry — runs the full agentic loop */
  async chat(userMessage) {
    this.history.push({ role: 'user', text: userMessage });

    const spinner = this.ui.spinner('Thinking…');
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      let response;
      try {
        response = await this._provider.createMessage({
          model: this.config.model,
          maxTokens: this.config.maxTokens,
          system: this._systemPrompt,
          tools: this._allTools(),
          history: this.history,
          instructions: this._provider.separateInstructions ? this.instructions?.text : null,
        });
      } catch (err) {
        spinner.fail('API error');
        throw err;
      }

      const { text, toolCalls, stopReason } = response;

      // Add assistant turn to history (neutral format)
      this.history.push({ role: 'assistant', text, toolCalls });

      // If we got text to show, print it
      if (text) {
        spinner.stop();
        this.ui.assistantMessage(text);
      }

      // If no tool calls, we're done
      if (!toolCalls || toolCalls.length === 0) {
        spinner.stop();
        break;
      }

      // Execute each tool call
      spinner.stop();
      const results = [];
      for (const call of toolCalls) {
        const output = await this._executeTool(call.name, call.input);
        results.push({ id: call.id, output });
      }

      // Feed results back into the loop
      this.history.push({ role: 'tool', results });
      spinner.start('Thinking…');

      if (stopReason === 'tool_use') {
        // Loop continues — the model will process the tool results
        continue;
      }

      // Any other stop reason: done
      spinner.stop();
      break;
    }

    if (iterations >= MAX_ITERATIONS) {
      this.ui.warn('Reached maximum tool iterations. Stopping.');
    }
  }
}
