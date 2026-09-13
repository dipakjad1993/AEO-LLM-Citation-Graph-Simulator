import axios from 'axios';

/**
 * xAI Grok 4 — OpenAI-compatible chat API with live search.
 * Response reports its own search cost: preserve usage.search_cost.
 * ~3.5c/answer (Stork Aug 2026).
 */
export class GrokProvider {
  constructor(apiKey, config) {
    this.apiKey = apiKey;
    this.config = config;
    this.baseUrl = 'https://api.x.ai/v1/chat/completions';
  }

  async chat(messages, options = {}) {
    const { model = 'grok-4', temperature = 0.15, max_tokens = 4096, top_p = 0.9, search_enabled = true, tool_choice = 'auto' } = options;
    const body = { model, messages: messages.map(m => ({ role: m.role, content: m.content })), temperature, max_tokens, top_p };
    if (search_enabled) { body.tools = [{ type: 'web_search' }]; body.tool_choice = tool_choice; }
    else { body.tool_choice = 'none'; }
    const response = await axios.post(this.baseUrl, body, {
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000
    });
    const data = response.data;
    const choice = data.choices?.[0];
    const msg = choice?.message || {};
    const rawText = typeof msg.content === 'string' ? msg.content : '';
    const citations = [];
    for (const a of msg.annotations || []) {
      if ((a.type === 'url_citation' || a.type === 'citation') && (a.url || a.uri)) {
        citations.push({ url: a.url || a.uri, title: a.title || null, snippet: null });
      }
    }
    const urlRegex = /https?:\/\/[^\s\)\]\>"']+/g;
    for (const u of rawText.match(urlRegex) || []) {
      const clean = u.replace(/[.,;:!?)]+$/, '');
      if (!citations.find(c => c.url === clean)) citations.push({ url: clean, title: null, snippet: null, fallback: true });
    }
    const searchPerformed = citations.length > 0;
    return {
      raw_text: rawText,
      model: data.model || model,
      usage: { ...(data.usage || {}), search_cost_usd: data.usage?.search_cost ?? data.search_cost ?? null },
      finish_reason: choice?.finish_reason,
      citations,
      sources: citations,
      inline_citations: citations,
      hidden_search_queries: [],
      search_performed: Boolean(searchPerformed),
      search_requested: Boolean(search_enabled),
      ungrounded: Boolean(search_enabled) && !searchPerformed,
      raw_response: data
    };
  }
}
