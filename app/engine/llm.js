'use strict';
// Minimal OpenAI-compatible chat client (F04). Works with any provider that
// implements POST {baseUrl}/chat/completions (OpenAI, DeepSeek, Ollama, vLLM...).

class LlmClient {
  constructor({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.apiKey = apiKey || '';
    this.model = model || 'gpt-4o-mini';
    this.temperature = temperature === undefined ? 0.2 : temperature;
  }

  async chat(messages, tools) {
    const body = { model: this.model, messages, temperature: this.temperature };
    if (tools && tools.length) body.tools = tools;
    const res = await fetch(this.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: 'Bearer ' + this.apiKey } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('LLM HTTP ' + res.status + ': ' + text.slice(0, 300));
    }
    const json = await res.json();
    const msg = json.choices && json.choices[0] && json.choices[0].message;
    if (!msg) throw new Error('LLM response missing choices[0].message');
    return msg;
  }

  /** One real request with a trivial prompt; used by "test connection". */
  async ping() {
    const msg = await this.chat([{ role: 'user', content: 'ping' }], []);
    return { ok: true, reply: (msg.content || '').slice(0, 100) };
  }
}

module.exports = { LlmClient };
