// src/ui/input.js — a boxed prompt with pasted-text collapsing, à la Claude Code.
//
// - A long or multi-line paste is shown as a placeholder like
//   "[pasted text #1 +42 lines]" so it doesn't flood the prompt; the full text
//   is restored when the line is submitted.
// - The input sits inside a light ─── border with a › marker.
//
// Falls back to a plain single line when stdin is not a TTY (pipes, tests).

import { createInterface, emitKeypressEvents } from 'readline';

const RULE = (w) => '─'.repeat(Math.max(8, Math.min(w, 100)));

/**
 * Read one line of input. Returns the full text (placeholders expanded), or
 * null on Ctrl+C / EOF.
 * @param {{ prompt?: string, colors?: object }} opts
 */
export function readInput({ prompt = '› ', colors = {} } = {}) {
  const stdin = process.stdin;
  const paint = colors.rule || ((s) => s);
  const mark = colors.mark || ((s) => s);
  const tag = colors.tag || ((s) => s);

  if (!stdin.isTTY) return readInputPlain(prompt);

  return new Promise((resolve) => {
    const width = process.stdout.columns || 80;
    let buf = '';
    let cursor = 0;
    const pastes = [];            // { token, text }
    let pasteMode = false;
    let pasteAcc = '';

    process.stdout.write('\n' + paint(RULE(width)) + '\n');

    emitKeypressEvents(stdin);
    try { stdin.setRawMode(true); } catch { /* not a tty */ }
    stdin.resume();
    try { process.stdout.write('\x1b[?2004h'); } catch { /* bracketed paste */ }

    const render = () => {
      // Redraw the single input line: clear, draw marker + buffer, place cursor.
      const line = mark(' ' + prompt) + colorizeTokens(buf, tag);
      process.stdout.write('\r\x1b[2K' + line);
      // Move the terminal cursor to the logical cursor position.
      const visibleBefore = stripAnsiLen(mark(' ' + prompt)) + displayWidth(buf.slice(0, cursor));
      process.stdout.write('\r' + (visibleBefore ? `\x1b[${visibleBefore}C` : ''));
    };

    const finish = (result) => {
      try { process.stdout.write('\x1b[?2004l'); } catch { /* ignore */ }
      stdin.removeListener('keypress', onKey);
      try { stdin.setRawMode(false); } catch { /* ignore */ }
      stdin.pause();
      process.stdout.write('\n' + paint(RULE(width)) + '\n');
      if (result === null) return resolve(null);
      // Expand placeholders back to the real pasted text.
      let text = buf;
      for (const p of pastes) text = text.split(p.token).join(p.text);
      resolve(text);
    };

    const insert = (str) => {
      buf = buf.slice(0, cursor) + str + buf.slice(cursor);
      cursor += str.length;
    };

    const onKey = (str, key) => {
      key = key || {};

      // --- bracketed paste framing ---
      if (str && str.includes('\x1b[200~')) { pasteMode = true; pasteAcc = ''; str = str.split('\x1b[200~').pop(); }
      if (pasteMode) {
        const end = str ? str.indexOf('\x1b[201~') : -1;
        if (end === -1) { pasteAcc += str || ''; return; }
        pasteAcc += str.slice(0, end);
        addPaste(pasteAcc);
        pasteMode = false; pasteAcc = '';
        render();
        return;
      }

      if (key.ctrl && key.name === 'c') return finish(null);
      if (key.ctrl && key.name === 'd' && buf === '') return finish(null);
      if (key.name === 'return' || key.name === 'enter') return finish('ok');
      if (key.name === 'backspace') { if (cursor > 0) { buf = buf.slice(0, cursor - 1) + buf.slice(cursor); cursor--; } return render(); }
      if (key.name === 'delete') { buf = buf.slice(0, cursor) + buf.slice(cursor + 1); return render(); }
      if (key.name === 'left') { if (cursor > 0) cursor--; return render(); }
      if (key.name === 'right') { if (cursor < buf.length) cursor++; return render(); }
      if (key.name === 'home') { cursor = 0; return render(); }
      if (key.name === 'end') { cursor = buf.length; return render(); }
      if (key.ctrl && key.name === 'u') { buf = buf.slice(cursor); cursor = 0; return render(); }

      // A multi-char chunk with a newline is almost certainly a paste from a
      // terminal without bracketed-paste support.
      if (str && str.length > 1 && /[\r\n]/.test(str)) { addPaste(str.replace(/\r?\n?$/, '')); return render(); }

      if (str && !key.ctrl && !key.meta) { insert(str); return render(); }
    };

    const addPaste = (raw) => {
      const clean = raw.replace(/\r/g, '');
      const lines = clean.split('\n').length;
      // Short single-line pastes go in verbatim; long / multi-line collapse.
      if (lines === 1 && clean.length <= 200) { insert(clean); return; }
      const token = `[pasted text #${pastes.length + 1} +${lines} lines]`;
      pastes.push({ token, text: clean });
      insert(token);
    };

    stdin.on('keypress', onKey);
    render();
  });
}

function readInputPlain(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { rl.close(); } catch { /* ignore */ } resolve(v); };
    rl.question(' ' + prompt, (a) => finish(a));
    rl.on('close', () => finish(null));
  });
}

// Show placeholder tokens in a distinct colour without affecting length logic.
function colorizeTokens(s, tag) {
  return s.replace(/\[pasted text #\d+ \+\d+ lines\]/g, (m) => tag(m));
}

function stripAnsiLen(s) {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').length;
}

function displayWidth(s) {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').length;
}
