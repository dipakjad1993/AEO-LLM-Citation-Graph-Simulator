import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic 2026: Claude 4.x + web_search tool.
 * Citations arrive as content[] blocks with type web_search_tool_result
 * (content[].url + title), NOT legacy text-block citations.
 * utm_source params are stripped so domain attribution is clean.
 */
export class AnthropicProvider {
  constructor(apiKey, config) {
    this.client = new Anthropic({ apiKey });
    this.config = config;
  }

  stripUtm(url) {
    try {
      const u = new URL(url);
      for (const k of [...u.searchParams.keys()]) {
        if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
      }
      u.hash = '';
      return u.toString();
    } catch { return url; }
  }

  async chat(messages, options = {}) {
    // Late-2026 refresh: web_search_20260209 supersedes 20250305; supports user_location.
    const { model = 'claude-sonnet-4-20250514', temperature = 0.15, max_tokens = 4096, search_enabled, allowed_domains = [], geo = null } = options;

    let systemMessage = '';
    const apiMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') systemMessage = msg.content;
      else apiMessages.push({ role: msg.role, content: msg.content });
    }

    const body = { model, max_tokens, temperature, messages: apiMessages };
    if (systemMessage) body.system = systemMessage;
    const hiddenQueries = [];
    if (search_enabled) {
      const toolType = process.env.ANTHROPIC_SEARCH_TOOL || 'web_search_20260209';
      const tool = { type: toolType, name: 'web_search', max_uses: 5 };
      if (allowed_domains?.length) tool.allowed_search_results = allowed_domains.map(d => ({ type: 'domain', domain: d }));
      if (geo) tool.user_location = { type: 'approximate', country: String(geo).toUpperCase().slice(0, 2) };
      body.tools = [tool];
      body.tool_choice = { type: 'auto' };
    } else {
      body.tool_choice = { type: 'none' };
    }

    const response = await this.client.messages.create(body);
    const rawText = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const { citations, sources } = this.extractCitations(response);

    for (const b of response.content || []) {
      if (b.type === 'web_search_tool_result' && b.content) {
        // tool-use query echo lives on the paired web_search_tool_use block
      }
      if (b.type === 'server_tool_use' && b.name === 'web_search' && b.input?.query) hiddenQueries.push(b.input.query);
      if (b.type === 'web_search_tool_use' && b.input?.query) hiddenQueries.push(b.input.query);
    }

    const searchPerformed = citations.length > 0 || response.content?.some(b => b.type === 'web_search_tool_result');
    return {
      raw_text: rawText,
      model: response.model,
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      },
      finish_reason: response.stop_reason,
      citations,
      sources,
      inline_citations: citations,
      hidden_search_queries: hiddenQueries,
      search_performed: Boolean(searchPerformed),
      search_requested: Boolean(search_enabled),
      ungrounded: Boolean(search_enabled) && !searchPerformed,
      raw_response: response
    };
  }

  extractCitations(response) {
    const citations = [];
    for (const block of response.content || []) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r.type === 'web_search_result' && r.url) {
            citations.push({ url: this.stripUtm(r.url), title: r.title || null, snippet: (r.page_age || r.snippet || '')?.toString().slice(0, 300) || null });
          }
        }
      }
      // Legacy fallback: text-block citations array
      if (block.type === 'text' && block.citations) {
        for (const c of block.citations) {
          if (c.url) citations.push({ url: this.stripUtm(c.url), title: c.title || null, snippet: c.cited_text?.substring(0, 200) || null });
        }
      }
    }
    return { citations, sources: citations };
  }
}
