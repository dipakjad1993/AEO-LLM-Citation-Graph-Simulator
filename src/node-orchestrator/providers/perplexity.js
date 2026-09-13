import axios from 'axios';

/**
 * Perplexity 2026: flat citations[] array is authoritative.
 * Inline [n] markers map to citations[n-1]. Regex URL scraping is fallback only.
 */
export class PerplexityProvider {
  constructor(apiKey, config) {
    this.apiKey = apiKey;
    this.config = config;
    this.baseUrl = 'https://api.perplexity.ai/chat/completions';
  }

  async chat(messages, options = {}) {
    const { model = 'sonar-pro', temperature = 0.15, max_tokens = 4096, top_p = 0.9, search_enabled } = options;
    const body = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature, max_tokens, top_p,
      return_related_questions: true,
      return_images: false
    };
    const response = await axios.post(this.baseUrl, body, {
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000
    });
    const data = response.data;
    const choice = data.choices?.[0];
    const rawText = choice?.message?.content || '';
    const { citations, sources } = this.extractCitations(rawText, data);
    const searchPerformed = citations.length > 0 || Boolean(data.citations?.length);
    return {
      raw_text: rawText,
      model: data.model || model,
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: choice?.finish_reason,
      citations,
      sources,
      inline_citations: citations,
      related_questions: data.related_questions || [],
      hidden_search_queries: [],
      search_performed: Boolean(searchPerformed),
      search_requested: true,
      ungrounded: !searchPerformed,
      raw_response: data
    };
  }

  extractCitations(rawText, fullResponse) {
    // 1. Authoritative flat array
    const apiCites = Array.isArray(fullResponse.citations) ? fullResponse.citations : [];
    const sources = apiCites.map((c, i) => typeof c === 'string'
      ? { url: c, title: null, snippet: null, index: i + 1 }
      : { url: c.url || c.uri, title: c.title || null, snippet: c.snippet || null, index: i + 1 });

    // 2. Inline [n] -> sources[n-1]
    const inline = [];
    const numbered = /\[(\d+)\]/g;
    let m;
    while ((m = numbered.exec(rawText)) !== null) {
      const idx = parseInt(m[1], 10) - 1;
      if (sources[idx] && !inline.find(c => c.url === sources[idx].url)) inline.push(sources[idx]);
    }
    const merged = [...sources];
    // 3. Regex fallback for bare URLs not in citations[]
    const urlRegex = /https?:\/\/[^\s\)\]\>"']+/g;
    for (const u of rawText.match(urlRegex) || []) {
      const clean = u.replace(/[.,;:!?)]+$/, '');
      if (!merged.find(c => c.url === clean)) merged.push({ url: clean, title: null, snippet: null, fallback: true });
    }
    return { citations: merged, sources, inline_citations: inline.length ? inline : merged };
  }
}
