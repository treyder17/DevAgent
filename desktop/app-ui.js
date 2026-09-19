// desktop/app-ui.js — a UI adapter that forwards the agent's output to the
// renderer over IPC, in place of the terminal UI. Same method surface the
// Agent expects (print/info/warn/error/assistantMessage/toolCall/toolResult/
// spinner/…), so agent.js needs no changes.

export function makeAppUI(send) {
  const spinner = (text) => {
    send('status', { state: 'thinking', text: String(text || 'Thinking…') });
    const stop = () => send('status', { state: 'idle' });
    return {
      succeed: (m) => send('status', { state: 'done', text: String(m || '') }),
      fail: (m) => send('status', { state: 'error', text: String(m || '') }),
      stop,
      start: (m) => send('status', { state: 'thinking', text: String(m || 'Thinking…') }),
    };
  };

  return {
    banner() {},
    promptStr() { return ''; },
    inputTheme() { return {}; },

    print:   (m) => send('log', { kind: 'print',   text: String(m) }),
    info:    (m) => send('log', { kind: 'info',    text: String(m) }),
    success: (m) => send('log', { kind: 'success', text: String(m) }),
    warn:    (m) => send('log', { kind: 'warn',    text: String(m) }),
    error:   (m) => send('log', { kind: 'error',   text: String(m) }),

    assistantMessage: (t) => send('assistant', { text: String(t) }),

    toolCall:   (name, detail) => send('tool', { phase: 'call', name, detail: String(detail || '') }),
    toolResult: (output, ok)   => send('tool', { phase: 'result', ok: !!ok, text: String(output).slice(0, 6000) }),

    spinner,
  };
}
