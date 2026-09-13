import OpenAI from 'openai';

/**
 * OpenAI provider — 2026: Responses API (primary) + Chat Completions fallback.
 * - Responses API: input[] + tools:[{type:'web_search'}], tool_choice, citations in
 *   output[].content[].annotations[] (type url_citation) + top-level sources[].
 * - web_search_preview is DEAD (shut down 2026-07-23). Never send it.
 * - search_performed is FACT (did the run browse?) not intent.
 */
export class OpenAIProvider {
  constructor(apiKey, config) {
    this.client = new OpenAI({ apiKey });
    this.config = config;
  }

  buildSearchTool(options = {}) {
    const tool = { type: 'web_search' };
    if (options.search_context_size) tool.search_context_size = options.search_context_size;
    return tool;
  }

  async chat(messages, options = {}) {
    const {
      model = 'gpt-5.5',
      temperature = 0.15,
      max_tokens = 4096,
      top_p = 0.9,
      seed,
      search_enabled,
      tool_choice = 'auto',
      allowed_domains = [],
      search_context_size = 'medium',
      use_responses_api = true,
      stream = false
    } = options;

    if (use_responses_api && !stream) {
      return this.chatViaResponses(messages, { model, temperature, max_tokens, top_p, seed, search_enabled, tool_choice, allowed_domains, search_context_size });
    }
    return this.chatViaChatCompletions(messages, { model, temperature, max_tokens, top_p, seed, search_enabled, tool_choice, allowed_domains });
  }

  toResponsesInput(messages) {
    return messages.map(m => ({
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }]
    }));
  }

  async chatViaResponses(messages, opts) {
    const body = {
      model: opts.model,
      input: this.toResponsesInput(messages),
      temperature: opts.temperature,
      top_p: opts.top_p,
      max_output_tokens: opts.max_tokens
    };
    if (opts.seed !== undefined) body.seed = opts.seed;
    if (opts.search_enabled) {
      body.tools = [this.buildSearchTool({ search_context_size: opts.search_context_size })];
      body.tool_choice = opts.tool_choice || 'auto';
      if (opts.allowed_domains?.length) body.tools[0].filters = { allowed_domains: opts.allowed_domains };
    }
    const response = await this.client.responses.create(body);
    return this.parseResponsesApi(response, opts);
  }

  parseResponsesApi(response, opts = {}) {
    let rawText = '';
    const annotations = [];
    const sources = [];
    for (const item of response.output || []) {
      if (item.type === 'message' || item.type === 'output_text') {
        for (const part of item.content || []) {
          if (part.type === 'output_text' || part.type === 'text') {
            rawText += part.text || '';
            for (const a of part.annotations || []) {
              if (a.type === 'url_citation' && (a.url || a.uri)) {
                annotations.push({ url: a.url || a.uri, title: a.title || null, snippet: a.snippet || null, start: a.start_index, end: a.end_index });
              }
            }
          }
        }
      }
    }
    for (const s of response.sources || []) {
      if (s.url || s.uri) sources.push({ url: s.url || s.uri, title: s.title || null, snippet: s.snippet || null });
    }
    // Hidden search-query telemetry (Responses API exposes tool call items)
    const hiddenQueries = (response.output || [])
      .filter(o => o.type === 'web_search_call')
      .map(o => o.query || o.action?.query)
      .filter(Boolean);
    const searchPerformed = hiddenQueries.length > 0 || annotations.length > 0 || sources.length > 0;
    return {
      raw_text: rawText,
      model: response.model,
      usage: response.usage,
      finish_reason: response.status,
      refusal: null,
      citations: [...sources, ...annotations],
      sources,
      inline_citations: annotations,
      hidden_search_queries: hiddenQueries,
      // FACT not intent: only true when browse evidence exists
      search_performed: searchPerformed,
      search_requested: Boolean(opts.search_enabled),
      ungrounded: Boolean(opts.search_enabled) && !searchPerformed,
      raw_response: response
    };
  }

  async chatViaChatCompletions(messages, opts) {
    const body = { model: opts.model, messages, temperature: opts.temperature, max_tokens: opts.max_tokens, top_p: opts.top_p };
    if (opts.seed !== undefined) body.seed = opts.seed;
    if (opts.search_enabled) {
      body.tools = [{ type: 'web_search' }];
      body.tool_choice = opts.tool_choice || 'auto';
    }
    const response = await this.client.chat.completions.create(body);
    const choice = response.choices?.[0];
    const message = choice?.message || {};
    const content = typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content.filter(p => p?.type === 'output_text' || p?.type === 'text').map(p => p.text || '').join('') : '';
    const inline = [];
    const contentParts = Array.isArray(message.content) ? message.content : [];
    for (const p of contentParts) {
      for (const a of p.annotations || []) {
        if (a.type === 'url_citation' && (a.url || a.url_citation?.url)) {
          const u = a.url || a.url_citation.url;
          inline.push({ url: u, title: a.title || a.url_citation?.title || null, snippet: null });
        }
      }
    }
    for (const a of message.annotations || []) {
      if (a.type === 'url_citation' && a.url) inline.push({ url: a.url, title: a.title || null, snippet: null });
    }
    const searchPerformed = inline.length > 0;
    return {
      raw_text: content,
      model: response.model,
      usage: response.usage,
      finish_reason: choice?.finish_reason,
      refusal: message.refusal || null,
      citations: inline,
      sources: [],
      inline_citations: inline,
      hidden_search_queries: [],
      search_performed: searchPerformed,
      search_requested: Boolean(opts.search_enabled),
      ungrounded: Boolean(opts.search_enabled) && !searchPerformed,
      raw_response: response
    };
  }

  async* chatStream(messages, options = {}) {
    const { model = 'gpt-5.5', temperature = 0.15, max_tokens = 4096, top_p = 0.9, search_enabled } = options;
    const body = { model, messages, temperature, max_tokens, top_p, stream: true, stream_options: { include_usage: true } };
    if (search_enabled) { body.tools = [{ type: 'web_search' }]; body.tool_choice = 'auto'; }
    const stream = await this.client.chat.completions.create(body);
    let fullContent = ''; let usage = null;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      const part = typeof delta?.content === 'string' ? delta.content : '';
      if (part) { fullContent += part; yield { type: 'content', data: part }; }
      if (chunk.usage) usage = chunk.usage;
    }
    yield { type: 'done', data: { fullContent, usage } };
  }
}
