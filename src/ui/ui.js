// src/ui/ui.js — terminal UI helpers

import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Single source of truth for the version: package.json.
const VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, '../../package.json'), 'utf8')).version;
  } catch {
    return '?';
  }
})();

// DevAgent color palette
const C = {
  brand:   chalk.hex('#7C3AED'),   // violet
  assist:  chalk.hex('#A78BFA'),   // light violet
  success: chalk.hex('#34D399'),   // emerald
  warn:    chalk.hex('#FBBF24'),   // amber
  error:   chalk.hex('#F87171'),   // red
  muted:   chalk.hex('#6B7280'),   // gray
  tool:    chalk.hex('#38BDF8'),   // sky blue
  code:    chalk.hex('#FCD34D'),   // yellow
  dim:     chalk.dim,
};

export class UI {
  constructor(options = {}) {
    this.quiet = options.quiet ?? false;
    this._spinner = null;
  }

  banner() {
    console.log('');
    console.log(
      C.brand('  ██████╗ ███████╗██╗   ██╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗')
    );
    console.log(
      C.brand('  ██╔══██╗██╔════╝██║   ██║██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝')
    );
    console.log(
      C.brand('  ██║  ██║█████╗  ██║   ██║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ')
    );
    console.log(
      C.brand('  ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ')
    );
    console.log(
      C.brand('  ██████╔╝███████╗ ╚████╔╝ ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ')
    );
    console.log(
      C.brand('  ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ')
    );
    console.log('');
    console.log(C.muted('  AI coding assistant for your terminal  ') + C.assist('da') + C.muted(' v' + VERSION));
    console.log('');
  }

  promptStr() {
    return C.brand('da') + C.muted(' › ') ;
  }

  /** Colour functions for the boxed input reader. */
  inputTheme() {
    return { rule: C.muted, mark: C.brand, tag: C.tool };
  }

  print(msg) {
    console.log(msg);
  }

  info(msg) {
    console.log(C.muted('  ℹ  ') + C.muted(msg));
  }

  success(msg) {
    console.log(C.success('  ✓  ') + msg);
  }

  warn(msg) {
    console.log(C.warn('  ⚠  ') + msg);
  }

  error(msg) {
    console.error(C.error('  ✗  ') + msg);
  }

  /** Show an assistant text response */
  assistantMessage(text) {
    console.log('');
    console.log(renderMarkdown(text));
    console.log('');
  }

  /** Show a tool invocation */
  toolCall(toolName, detail) {
    const icon = toolName === 'run_command' ? '⚙' : toolName === 'write_file' ? '✎' : '📖';
    console.log(C.tool(`  ${icon} [${toolName}] `) + C.dim(detail));
  }

  /** Show a tool result */
  toolResult(output, ok) {
    const prefix = ok ? C.success('  → ') : C.error('  → ');
    const lines = output.split('\n').slice(0, 30); // cap display
    for (const line of lines) {
      console.log(prefix + C.dim(line));
    }
    if (output.split('\n').length > 30) {
      console.log(C.muted('  … (output truncated)'));
    }
  }

  /** Spinner */
  spinner(text) {
    this._spinner = ora({
      text: C.muted(text),
      spinner: 'dots',
      color: 'magenta',
      // MUST stay false. ora's stdin-discarder skips its setup on Windows but
      // still runs its teardown (process.stdin.pause() + setRawMode(false)),
      // which kills the readline prompt: after the first answer the chat
      // session accepted no further input and the process exited silently,
      // without ever emitting readline's 'close'.
      discardStdin: false,
    }).start();
    return {
      succeed: (msg) => this._spinner.succeed(C.muted(msg)),
      fail:    (msg) => this._spinner.fail(C.error(msg)),
      stop:    ()    => this._spinner.stop(),
      start:   (msg) => {
        this._spinner.text = C.muted(msg);
        this._spinner.start();
      },
    };
  }
}

// --- Markdown → ANSI for the terminal --------------------------------------
// The web models answer in Markdown; showing raw **, #, ``` and * is ugly.
// This renders the common cases to terminal styling and drops the syntax.

function inlineMd(s) {
  return s
    // inline code first, so its contents aren't further parsed
    .replace(/`([^`]+)`/g, (_, c) => C.code(c))
    .replace(/\*\*([^*]+)\*\*/g, (_, c) => chalk.bold(c))
    .replace(/__([^_]+)__/g, (_, c) => chalk.bold(c))
    .replace(/~~([^~]+)~~/g, (_, c) => chalk.strikethrough(c))
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:)]|$)/g, (_, p, c) => p + chalk.italic(c))
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s.,;:)]|$)/g, (_, p, c) => p + chalk.italic(c))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `${chalk.cyan.underline(t)} (${C.muted(u)})`);
}

export function renderMarkdown(text) {
  const out = [];
  let inFence = false;
  let fenceLang = '';

  for (const raw of String(text ?? '').split('\n')) {
    const fence = raw.match(/^\s*```(.*)$/);
    if (fence) {
      if (!inFence) { inFence = true; fenceLang = fence[1].trim(); out.push(C.muted(fenceLang ? `┌─ ${fenceLang}` : '┌─')); }
      else { inFence = false; out.push(C.muted('└─')); }
      continue;
    }
    if (inFence) { out.push(C.code('│ ') + C.code(raw)); continue; }

    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(chalk.bold.hex('#A78BFA')(inlineMd(h[2]))); continue; }

    if (/^\s*([-*+])\s+/.test(raw)) {
      out.push(inlineMd(raw.replace(/^(\s*)[-*+]\s+/, (_, sp) => sp + C.brand('• '))));
      continue;
    }
    const oli = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (oli) { out.push(oli[1] + C.brand(`${oli[2]}. `) + inlineMd(oli[3])); continue; }

    if (/^\s*>\s?/.test(raw)) { out.push(C.muted('│ ') + C.dim(inlineMd(raw.replace(/^\s*>\s?/, '')))); continue; }

    if (/^\s*([-*_]){3,}\s*$/.test(raw)) { out.push(C.muted('─'.repeat(40))); continue; }

    out.push(inlineMd(raw));
  }
  return out.join('\n');
}
