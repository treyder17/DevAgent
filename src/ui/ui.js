// src/ui/ui.js — terminal UI helpers

import chalk from 'chalk';
import ora from 'ora';

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
    console.log(C.muted('  AI coding assistant for your terminal  ') + C.assist('da') + C.muted(' v1.0.0'));
    console.log('');
  }

  promptStr() {
    return C.brand('da') + C.muted(' › ') ;
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
    const lines = text.split('\n');
    for (const line of lines) {
      // Code blocks get yellow tint
      if (line.startsWith('```') || line.startsWith('    ')) {
        console.log(C.code(line));
      } else if (line.match(/^#{1,3} /)) {
        console.log(C.assist.bold(line));
      } else {
        console.log(line);
      }
    }
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
