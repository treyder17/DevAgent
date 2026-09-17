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

  try {
    const parsed = JSON.parse(json);
    const name = parsed.tool || parsed.name;
    if (!name) return null;
    return { name, input: parsed.input ?? parsed.arguments ?? parsed.parameters ?? {} };
  } catch {
    return null;
  }
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
