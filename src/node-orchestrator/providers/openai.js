import OpenAI from 'openai';

export class OpenAIProvider {
  constructor(apiKey, config) {
    this.client = new OpenAI({ apiKey });
    this.config = config;
  }

  async chat(messages, options = {}) {
    const { model = 'gpt-4o', temperature = 0.15, max_tokens = 4096, top_p = 0.9, seed, search_enabled, stream = false } = options;

    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens,
      top_p
    };

    if (seed !== undefined) requestBody.seed = seed;

    if (search_enabled) {
      requestBody.tools = [{ type: 'web_search_preview' }];
    }

    const response = await this.client.chat.completions.create(requestBody);

    const choice = response.choices?.[0];
    const message = choice?.message || {};
    const rawText = extractOpenAIContent(message);

    // web_search_preview returns grounded citations as message.annotations[] with
    // { type: 'url_citation', url, title }. Legacy responses may also surface
    // search tool_calls. Both are captured here.
    const rawCitations = [];
    for (const annotation of message.annotations || []) {
      if (annotation?.type === 'url_citation' && annotation.url) {
        rawCitations.push({
          url: annotation.url,
          title: annotation.title || null,
          snippet: null
        });
      }
    }
    for (const toolCall of message.tool_calls || []) {
      if (toolCall.type === 'web_search') {
        try {
          const searchData = JSON.parse(toolCall.function?.arguments || '{}');
          for (const result of searchData.results || []) {
            rawCitations.push({
              url: result.url,
              title: result.title,
              snippet: result.snippet
            });
          }
        } catch {
          // malformed search arguments: ignore, response content is still valid
        }
      }
    }

    return {
      raw_text: rawText,
      model: response.model,
      usage: response.usage,
      finish_reason: choice?.finish_reason,
      refusal: message.refusal || null,
      citations: rawCitations,
      search_performed: search_enabled || false,
      raw_response: response
    };
  }

  async* chatStream(messages, options = {}) {
    const { model = 'gpt-4o', temperature = 0.15, max_tokens = 4096, top_p = 0.9, search_enabled } = options;

    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens,
      top_p,
      stream: true,
      stream_options: { include_usage: true }
    };

    if (search_enabled) {
      requestBody.tools = [{ type: 'web_search_preview' }];
    }

    const stream = await this.client.chat.completions.create(requestBody);

    let fullContent = '';
    let usage = null;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      const part = extractOpenAIDelta(delta);
      if (part) {
        fullContent += part;
        yield { type: 'content', data: part };
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }

    yield { type: 'done', data: { fullContent, usage } };
  }
}

function extractOpenAIContent(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(p => p?.type === 'output_text' || p?.type === 'text')
      .map(p => p.text || '')
      .join('');
  }
  return '';
}

function extractOpenAIDelta(delta) {
  const content = delta?.content;
  if (typeof content === 'string') return content;
  return '';
}
