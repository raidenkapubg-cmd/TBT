// Minimal Groq chat-completions client (OpenAI-compatible API).
const config = require('../config');

const URL = 'https://api.groq.com/openai/v1/chat/completions';

function enabled() {
  return Boolean(config.groqKey);
}

async function chat(messages, { maxTokens = 200, temperature = 0.9, json = false } = {}) {
  if (!enabled()) return null;
  const body = {
    model: config.groqModel,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (json) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('[groq]', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[groq] request failed:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function chatJson(messages, opts = {}) {
  const text = await chat(messages, { ...opts, json: true, temperature: opts.temperature ?? 0.2 });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

module.exports = { enabled, chat, chatJson };
