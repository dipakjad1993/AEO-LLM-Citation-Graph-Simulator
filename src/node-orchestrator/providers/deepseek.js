import axios from 'axios';

/** DeepSeek V3 — no browsing. Memory baseline for RAG-vs-Base attribution. */
export class DeepSeekProvider {
  constructor(apiKey, config) {
    this.apiKey = apiKey;
    this.config = config;
    this.baseUrl = 'https://api.deepseek.com/chat/completions';
  }

  async chat(messages, options = {}) {
    const { model = 'deepseek-chat', temperature = 0.15, max_tokens = 4096, top_p = 0.9 } = options;
    const body = { model, messages: messages.map(m => ({ role: m.role, content: m.content })), temperature, max_tokens, top_p, frequency_penalty: 0, presence_penalty: 0 };
    const response = await axios.post(this.baseUrl, body, {
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000
    });
    const data = response.data;
    const choice = data.choices?.[0];
    return {
      raw_text: choice?.message?.content || '',
      model: data.model || model,
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: choice?.finish_reason,
      citations: [],
      sources: [],
      inline_citations: [],
      hidden_search_queries: [],
      search_performed: false,
      search_requested: false,
      ungrounded: true,
      memory_only: true,
      raw_response: data
    };
  }
}
