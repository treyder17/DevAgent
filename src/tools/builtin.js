// src/tools/builtin.js — built-in agent tools (shell, git, file I/O)

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Execute a shell command and return stdout/stderr.
 * Runs in the agent's working directory.
 */
export function runShell(command, workdir, timeoutMs = 30000) {
  try {
    const result = spawnSync(command, {
      shell: true,
      cwd: workdir,
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024, // 2 MB
    });

    return {
      ok: result.status === 0,
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim(),
      exitCode: result.status ?? -1,
    };
  } catch (err) {
    return { ok: false, stdout: '', stderr: err.message, exitCode: -1 };
  }
}

/**
 * Read a file relative to workdir.
 */
export function readFile(relPath, workdir) {
  const fullPath = join(workdir, relPath);
  if (!existsSync(fullPath)) return { ok: false, error: 'File not found' };
  try {
    return { ok: true, content: readFileSync(fullPath, 'utf8') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Write a file relative to workdir.
 */
export function writeFile(relPath, content, workdir) {
  const fullPath = join(workdir, relPath);
  try {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Tool definitions for the Anthropic API tool_use format
export const TOOL_DEFINITIONS = [
  {
    name: 'run_command',
    description: `Execute a shell command in the project's working directory.
Use this for: running tests, building, linting, git operations, package management, and any terminal task.
Always prefer specific commands over interactive ones. Never run commands that require user input.
Examples: "npm test", "python -m pytest src/", "git status", "git add -A && git commit -m '...'".
For dangerous operations (rm -rf, format, drop table), explain to the user first and only run if they confirmed.`,
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to run.',
        },
        explanation: {
          type: 'string',
          description: 'Brief explanation of what this command does and why.',
        },
      },
      required: ['command', 'explanation'],
    },
  },
  {
    name: 'read_file',
    description: `Read the contents of a file in the project.
Use this when you need to see the current content of a specific file to answer a question or make changes.`,
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file, relative to the project root.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: `Write or overwrite a file in the project.
Use this to create new files or update existing ones. Always show the user what you are writing.
Do not write binary files. Do not write outside the project root.`,
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file, relative to the project root.',
        },
        content: {
          type: 'string',
          description: 'The full content to write to the file.',
        },
        explanation: {
          type: 'string',
          description: 'What this file does / why you are writing it.',
        },
      },
      required: ['path', 'content', 'explanation'],
    },
  },
];
