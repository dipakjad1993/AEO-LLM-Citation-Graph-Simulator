import axios from 'axios';

export class DeepSeekProvider {
  constructor(apiKey, config) {
    this.apiKey = apiKey;
    this.config = config;
    this.baseUrl = 'https://api.deepseek.com/chat/completions';
  }

  async chat(messages, options = {}) {
    const { model = 'deepseek-chat', temperature = 0.15, max_tokens = 4096, top_p = 0.9, search_enabled } = options;

    const requestBody = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens,
      top_p,
      frequency_penalty: 0,
      presence_penalty: 0
    };

    const response = await axios.post(this.baseUrl, requestBody, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
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
      search_performed: false,
      raw_response: data
    };
  }
}
