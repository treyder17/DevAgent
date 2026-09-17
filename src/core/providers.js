// src/core/providers.js — multi-provider LLM layer (Anthropic + OpenAI-compatible)
//
// DevAgent speaks a single, provider-neutral message format internally.
// Each provider translates that format to/from its own wire protocol so the
// agent loop never has to care whether it's talking to Claude, DeepSeek, etc.
//
// Neutral history entries:
//   { role: 'user',      text }
//   { role: 'assistant', text, toolCalls: [{ id, name, input }] }
//   { role: 'tool',      results: [{ id, output }] }
//
// Neutral tool definitions use the Anthropic shape: { name, description, input_schema }.
//
// provider.createMessage({ system, tools, history, model, maxTokens })
//   -> { text, toolCalls: [{ id, name, input }], stopReason }

import Anthropic from '@anthropic-ai/sdk';
import { DeepSeekWebProvider } from './deepseek-web.js';

// Known providers. `type` picks the wire protocol; `openai` covers every
// OpenAI-compatible endpoint (DeepSeek, OpenRouter, OpenAI, local servers…).
export const PROVIDERS = {
  anthropic: {
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-6',
  },
  deepseek: {
    type: 'openai',
    baseUrl: 'https://api.deepseek.com',
    envKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
  },
  openrouter: {
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
  },
  openai: {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
  // No API key at all: drives the free chat.deepseek.com web app in a browser.
  'deepseek-web': {
    type: 'browser',
    baseUrl: 'https://chat.deepseek.com',
    envKey: null,
    defaultModel: 'deepseek-web',
    keyless: true,
  },
};

/**
 * Guess which provider a model belongs to, when not set explicitly.
 *   deepseek-web*       -> deepseek-web (browser bridge, no key)
 *   claude-*            -> anthropic
 *   deepseek-*          -> deepseek (official API)
 *   vendor/model[:tag]  -> openrouter (their models are namespaced)
 *   gpt-* / o1-* / o3-* -> openai
 */
export function detectProvider(model) {
  if (!model) return 'anthropic';
  const m = model.toLowerCase();
  if (m.startsWith('deepseek-web') || m === 'deepthink') return 'deepseek-web';
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('deepseek-')) return 'deepseek';
  if (m.includes('/')) return 'openrouter';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
  return 'anthropic';
}

/**
 * Build a provider instance from resolved config.
 * Expects: { provider, model, apiKey, baseUrl, verbose }
 */
export function createProvider(config) {
  const name = config.provider || detectProvider(config.model);
  const preset = PROVIDERS[name];
  if (!preset) {
    throw new Error(
      `Unknown provider "${name}". Known: ${Object.keys(PROVIDERS).join(', ')}.`
    );
  }

  const baseUrl = (config.baseUrl || preset.baseUrl).replace(/\/+$/, '');
  const apiKey = config.apiKey;

  if (preset.type === 'browser') {
    return new DeepSeekWebProvider({ name, model: config.model, config, ui: config.ui });
  }
  if (preset.type === 'anthropic') {
    return new AnthropicProvider({ name, apiKey, baseUrl, verbose: config.verbose });
  }
  return new OpenAIProvider({ name, apiKey, baseUrl, verbose: config.verbose });
}

// ---------------------------------------------------------------------------
// Anthropic (Claude)
// ---------------------------------------------------------------------------

class AnthropicProvider {
  constructor({ name, apiKey, baseUrl, verbose }) {
    this.name = name;
    this.verbose = verbose;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this._client = new Anthropic({ apiKey, baseURL: baseUrl });
  }

  _toWire(history) {
    const messages = [];
    for (const turn of history) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: turn.text });
      } else if (turn.role === 'assistant') {
        const content = [];
        if (turn.text) content.push({ type: 'text', text: turn.text });
        for (const tc of turn.toolCalls || []) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
        messages.push({ role: 'assistant', content });
      } else if (turn.role === 'tool') {
        messages.push({
          role: 'user',
          content: turn.results.map(r => ({
            type: 'tool_result',
            tool_use_id: r.id,
            content: r.output,
          })),
        });
      }
    }
    return messages;
  }

  async createMessage({ system, tools, history, model, maxTokens }) {
    const response = await this._client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools, // already in Anthropic shape
      messages: this._toWire(history),
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    const toolCalls = response.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, input: b.input }));

    return { text, toolCalls, stopReason: response.stop_reason };
  }

  async listModels() {
    const res = await fetch(`${this.baseUrl}/v1/models`, {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) throw new Error(`anthropic models error ${res.status}`);
    const data = await res.json();
    // Anthropic has no "free" concept and all current models support tools.
    return (data.data || []).map(m => ({ id: m.id, free: false, tools: true }));
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (DeepSeek, OpenRouter, OpenAI, local, …)
// ---------------------------------------------------------------------------

class OpenAIProvider {
  constructor({ name, apiKey, baseUrl, verbose }) {
    this.name = name;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.verbose = verbose;
  }

  _toolsToWire(tools) {
    return (tools || []).map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  _toWire(system, history) {
    const messages = [{ role: 'system', content: system }];
    for (const turn of history) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: turn.text });
      } else if (turn.role === 'assistant') {
        const msg = { role: 'assistant', content: turn.text || '' };
        if (turn.toolCalls && turn.toolCalls.length) {
          msg.tool_calls = turn.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
          }));
        }
        messages.push(msg);
      } else if (turn.role === 'tool') {
        for (const r of turn.results) {
          messages.push({ role: 'tool', tool_call_id: r.id, content: r.output });
        }
      }
    }
    return messages;
  }

  async createMessage({ system, tools, history, model, maxTokens }) {
    const body = {
      model,
      max_tokens: maxTokens,
      messages: this._toWire(system, history),
    };
    const wireTools = this._toolsToWire(tools);
    if (wireTools.length) {
      body.tools = wireTools;
      body.tool_choice = 'auto';
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    // OpenRouter likes these for attribution; harmless elsewhere.
    if (this.name === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/treyder17/DevAgent';
      headers['X-Title'] = 'DevAgent';
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${this.name} API error ${res.status}: ${detail.slice(0, 500)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error(`${this.name}: empty response (${JSON.stringify(data).slice(0, 300)})`);
    }

    const message = choice.message || {};
    const text = message.content || '';
    const toolCalls = (message.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function?.name,
      input: safeParse(tc.function?.arguments),
    }));

    // Normalize finish reason to Anthropic-style stop_reason.
    const stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use'
      : choice.finish_reason === 'length' ? 'max_tokens'
      : 'end_turn';

    return { text, toolCalls, stopReason };
  }

  async listModels() {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`${this.name} models error ${res.status}`);
    const data = await res.json();
    return (data.data || []).map(m => {
      // Pricing is only present on OpenRouter; treat "0"/0 for both sides as free.
      const p = m.pricing;
      const isZero = v => v === 0 || v === '0';
      const free = p ? (isZero(p.prompt) && isZero(p.completion)) : false;
      const params = m.supported_parameters || [];
      // If a provider doesn't advertise params, assume tool support (OpenAI/DeepSeek do).
      const tools = params.length ? params.includes('tools') : true;
      return { id: m.id, free, tools, hasPricing: !!p };
    });
  }
}

function safeParse(str) {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
