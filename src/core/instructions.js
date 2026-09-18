// src/core/instructions.js — standing instructions for a session.
//
// A file whose contents are handed to the model before your first request, so
// project rules (language, style, conventions, architecture notes) do not have
// to be repeated every time.
//
// Resolution order — first hit wins:
//   1. --instructions <path>
//   2. config: da config set instructionsFile "C:\\path\\to\\file.txt"
//   3. DEVAGENT.md in the working directory
//
// Providers with a real system prompt get it appended there. Chat-UI providers
// send it as its own opening message (see DeepSeekWebProvider).

import { existsSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

export const DEFAULT_INSTRUCTIONS_FILE = 'DEVAGENT.md';
const MAX_CHARS = 20000;

/**
 * @returns {{ text: string, path: string, truncated: boolean } | null}
 */
export function loadInstructions(config = {}, workdir = process.cwd(), ui = null) {
  if (config.noInstructions) return null;
  const explicit = config.instructionsFile || null;
  const candidates = explicit
    ? [isAbsolute(explicit) ? explicit : resolve(workdir, explicit)]
    : [join(workdir, DEFAULT_INSTRUCTIONS_FILE)];

  for (const path of candidates) {
    if (!existsSync(path) || !statSync(path).isFile()) continue;

    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (err) {
      ui?.warn(`Could not read instructions file ${path}: ${err.message}`);
      continue;
    }

    if (!text.trim()) return null;

    let truncated = false;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      truncated = true;
      ui?.warn(`Instructions file trimmed to ${MAX_CHARS} chars.`);
    }
    return { text: text.trim(), path, truncated };
  }

  // An explicitly configured file that is missing is a mistake worth reporting.
  if (explicit) ui?.warn(`Instructions file not found: ${candidates[0]}`);
  return null;
}
