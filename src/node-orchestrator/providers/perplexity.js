import axios from 'axios';

export class PerplexityProvider {
  constructor(apiKey, config) {
    this.apiKey = apiKey;
    this.config = config;
    this.baseUrl = 'https://api.perplexity.ai/chat/completions';
  }

  async chat(messages, options = {}) {
    const { model = 'sonar-pro', temperature = 0.15, max_tokens = 4096, top_p = 0.9, search_enabled } = options;

    const requestBody = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens,
      top_p,
      return_related_questions: true,
      return_images: false
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
    const rawText = choice?.message?.content || '';

    const citations = this.extractCitations(rawText, data);

    return {
      raw_text: rawText,
      model: data.model || model,
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: choice?.finish_reason,
      citations,
      related_questions: data.related_questions || [],
      search_performed: Boolean(search_enabled),
      raw_response: data
    };
  }

  extractCitations(rawText, fullResponse) {
    const citations = [];

    const urlRegex = /https?:\/\/[^\s\)\]\>"']+/g;
    const urls = rawText.match(urlRegex) || [];
    for (const url of urls) {
      citations.push({ url: url.replace(/[.,;:!?)]+$/, ''), title: null, snippet: null });
    }

    const numberedPattern = /\[(\d+)\]/g;
    let match;
    while ((match = numberedPattern.exec(rawText)) !== null) {
      const idx = parseInt(match[1]);
      if (idx > 0 && idx <= 20) {
        const contextStart = Math.max(0, match.index - 100);
        const contextEnd = Math.min(rawText.length, match.index + 100);
        const context = rawText.substring(contextStart, contextEnd);

        const contextUrl = context.match(/https?:\/\/[^\s\)\]\>"']+/);
        if (contextUrl && !citations.find(c => c.url === contextUrl[0])) {
          citations.push({ url: contextUrl[0].replace(/[.,;:!?)]+$/, ''), title: null, snippet: context.trim() });
        }
      }
    }

    return citations;
  }
}
