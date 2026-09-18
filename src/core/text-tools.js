// src/core/text-tools.js — tool calling over plain text.
// Web chat UIs have no structured tool API, so the model emits a sentinel-
// delimited JSON call and DevAgent feeds the result back as plain text.

const OPEN = '<<<TOOL>>>';
const CLOSE = '<<<END>>>';

export const MAX_RESULT_CHARS = 8000;

/** Describe the available tools plus the calling protocol for the system prompt. */
export function buildToolPrompt(toolDefinitions) {
  const list = toolDefinitions.map((t) => {
    const props = t.input_schema?.properties ?? {};
    const required = t.input_schema?.required ?? [];
    const params = Object.entries(props)
      .map(([name, spec]) => {
        const flag = required.includes(name) ? '' : '?';
        return `    "${name}"${flag}: ${spec.type || 'string'} — ${spec.description || ''}`.trimEnd();
      })
      .join('\n');
    return `- ${t.name}: ${t.description}\n${params}`;
  }).join('\n');

  return `## Tools
You cannot act directly — you act by emitting a tool call. Available tools:

${list}

## Tool call protocol (follow exactly)
To use a tool, end your message with ONE line in this exact form:

${OPEN}{"tool":"<name>","input":{ ... }}${CLOSE}

Hard rules:
- The whole call must be on a SINGLE line and must be valid JSON. Escape newlines inside strings.
- Inside a shell command, use SINGLE quotes, never double quotes — double quotes break the JSON. Good: "command":"powershell -Command 'Expand-Archive x.zip'".
- Emit at most ONE tool call per message, and write nothing after it.
- After the call, STOP. You will receive the output in a message starting with <<<RESULT>>>.
- Never invent tool output and never claim you ran something without emitting a call.
- When you are done and only want to answer the user, reply WITHOUT any ${OPEN} line.`;
}

/** Extract the first tool call from a model message, if any. */
export function parseToolCall(text) {
  if (!text) return null;

  const sentinel = new RegExp(OPEN + '\\s*([\\s\\S]*?)' + CLOSE);
  let raw = text.match(sentinel)?.[1];

  // Tolerate a missing closing sentinel or a fenced call.
  if (!raw && text.includes(OPEN)) {
    raw = text.slice(text.indexOf(OPEN) + OPEN.length);
  }
  if (!raw) {
    const fenced = text.match(/```(?:json|tool_call)?\s*(\{[\s\S]*?"tool"[\s\S]*?\})\s*```/);
    if (fenced) raw = fenced[1];
  }
  if (!raw) return null;

  const cleaned = raw.trim()
    .replace(/^```(?:json|tool_call)?/, '')
    .replace(/```$/, '')
    .trim();
  const json = extractJsonObject(cleaned);
  if (!json) return null;

  const parsed = parseJsonLoose(json);
  if (!parsed) return null;
  const name = parsed.tool || parsed.name;
  if (!name) return null;
  return { name, input: parsed.input ?? parsed.arguments ?? parsed.parameters ?? {} };
}

/**
 * JSON.parse, then a repair pass for the failure the web models hit most:
 * unescaped double quotes inside a string value, e.g.
 *   {"command":"powershell -Command "Expand-Archive ...""}
 * The repair re-escapes any quote that is not a structural delimiter.
 */
function parseJsonLoose(json) {
  try {
    return JSON.parse(json);
  } catch { /* fall through to repair */ }
  try {
    return JSON.parse(repairInnerQuotes(json));
  } catch {
    return null;
  }
}

/** Escape double quotes that sit inside a string value rather than delimit it. */
function repairInnerQuotes(json) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; esc = true; continue; }
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue; }
      // A closing quote is only real when the next non-space char is a
      // structural delimiter. Otherwise it is a stray quote inside the value.
      const next = json.slice(i + 1).match(/^\s*(.)/);
      const nc = next ? next[1] : '';
      if (nc === ':' || nc === ',' || nc === '}' || nc === ']' || nc === '') {
        inStr = false; out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}

/** True when a message looks like it MEANT to call a tool (even if malformed). */
export function hasToolAttempt(text) {
  if (!text) return false;
  if (text.includes(OPEN)) return true;
  return /```(?:json|tool_call)?\s*\{[\s\S]*?"tool"/.test(text);
}

/** Sent back when a tool call arrived but its JSON could not be parsed. */
export function malformedToolMessage() {
  return `<<<RESULT>>> error
Your previous tool call was NOT valid JSON, so nothing ran.
` +
    `Common cause: double quotes inside a value. Resend ONE line, valid JSON, ` +
    `using SINGLE quotes inside shell commands. Example:
` +
    `${OPEN}{"tool":"run_command","input":{"command":"powershell -Command \\"Get-ChildItem\\""}}${CLOSE}
` +
    `<<<ENDRESULT>>>

Resend the tool call now.`;
}

/** Grab the first balanced object so trailing prose cannot break parsing. */
function extractJsonObject(s) {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === String.fromCharCode(92)) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** Remove the tool call from text meant for the user. */
export function stripToolCall(text) {
  if (!text) return '';
  const idx = text.indexOf(OPEN);
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}

/** Format a tool result as the next user turn. */
export function formatToolResult(toolName, output) {
  let body = String(output ?? '');
  if (body.length > MAX_RESULT_CHARS) {
    body = body.slice(0, MAX_RESULT_CHARS) + `\n…[truncated, ${body.length} chars total]`;
  }
  return `<<<RESULT>>> tool: ${toolName}\n${body}\n<<<ENDRESULT>>>\n\nContinue. Call another tool if needed, otherwise answer the user.`;
}

export const SENTINELS = { OPEN, CLOSE };
