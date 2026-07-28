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
    const rawCitations = [];

    if (choice?.message?.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type === 'web_search') {
          const searchData = JSON.parse(toolCall.function.arguments || '{}');
          if (searchData.results) {
            for (const result of searchData.results) {
              rawCitations.push({
                url: result.url,
                title: result.title,
                snippet: result.snippet
              });
            }
          }
        }
      }
    }

    return {
      raw_text: choice?.message?.content || '',
      model: response.model,
      usage: response.usage,
      finish_reason: choice?.finish_reason,
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
      if (delta?.content) {
        fullContent += delta.content;
        yield { type: 'content', data: delta.content };
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }

    yield { type: 'done', data: { fullContent, usage } };
  }
}
