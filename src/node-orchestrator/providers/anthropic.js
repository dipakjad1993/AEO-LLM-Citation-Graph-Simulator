import Anthropic from '@anthropic-ai/sdk';

export class AnthropicProvider {
  constructor(apiKey, config) {
    this.client = new Anthropic({ apiKey });
    this.config = config;
  }

  async chat(messages, options = {}) {
    const { model = 'claude-3-5-sonnet-20241022', temperature = 0.15, max_tokens = 4096, search_enabled } = options;

    let systemMessage = '';
    const apiMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessage = msg.content;
      } else {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const requestBody = {
      model,
      max_tokens,
      temperature,
      messages: apiMessages
    };

    if (systemMessage) requestBody.system = systemMessage;

    const response = await this.client.messages.create(requestBody);

    const rawText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return {
      raw_text: rawText,
      model: response.model,
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      },
      finish_reason: response.stop_reason,
      citations: this.extractAnthropicCitations(response),
      search_performed: search_enabled || false,
      raw_response: response
    };
  }

  extractAnthropicCitations(response) {
    const citations = [];
    if (response.content) {
      for (const block of response.content) {
        if (block.type === 'text' && block.citations) {
          for (const citation of block.citations) {
            citations.push({
              url: citation.url,
              title: citation.title,
              snippet: citation.cited_text?.substring(0, 200)
            });
          }
        }
      }
    }
    return citations;
  }
}
