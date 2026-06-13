// src/core/agent.js — agentic loop with Claude tool use

import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFINITIONS, runShell, readFile, writeFile } from '../tools/builtin.js';

const MAX_ITERATIONS = 20; // safety limit for the tool loop

export class Agent {
  constructor({ config, codebaseIndex, plugins, workdir, ui }) {
    this.config = config;
    this.codebaseIndex = codebaseIndex;
    this.plugins = plugins;
    this.workdir = workdir;
    this.ui = ui;
    this.history = []; // multi-turn conversation history

    this._client = new Anthropic({ apiKey: config.apiKey });
    this._systemPrompt = this._buildSystemPrompt();
  }

  clearHistory() {
    this.history = [];
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

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  /** Main chat entry — runs the full agentic loop */
  async chat(userMessage) {
    this.history.push({ role: 'user', content: userMessage });

    const spinner = this.ui.spinner('Thinking…');
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      let response;
      try {
        response = await this._client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: this._systemPrompt,
          tools: this._allTools(),
          messages: this.history,
        });
      } catch (err) {
        spinner.fail('API error');
        throw err;
      }

      // Collect text and tool_use blocks
      const textBlocks = response.content.filter(b => b.type === 'text');
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');

      // Add assistant turn to history
      this.history.push({ role: 'assistant', content: response.content });

      // If we got text to show, print it
      if (textBlocks.length > 0) {
        spinner.stop();
        const text = textBlocks.map(b => b.text).join('\n');
        this.ui.assistantMessage(text);
      }

      // If no tool calls, we're done
      if (toolBlocks.length === 0 || response.stop_reason === 'end_turn') {
        spinner.stop();
        break;
      }

      // Execute each tool call
      spinner.stop();
      const toolResults = [];
      for (const block of toolBlocks) {
        const output = await this._executeTool(block.name, block.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output,
        });
      }

      // Feed results back into the loop
      this.history.push({ role: 'user', content: toolResults });
      spinner.start('Thinking…');

      if (response.stop_reason === 'tool_use') {
        // Loop continues — Claude will process results
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
