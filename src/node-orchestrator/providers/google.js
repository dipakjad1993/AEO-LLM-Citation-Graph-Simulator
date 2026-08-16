import { GoogleGenerativeAI } from '@google/generative-ai';

export class GoogleProvider {
  constructor(apiKey, config) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.config = config;
  }

  async chat(messages, options = {}) {
    const { model = 'gemini-1.5-pro', temperature = 0.15, max_tokens = 4096, top_p = 0.9, search_enabled } = options;

    let systemInstruction = '';
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
      } else if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    }

    const tools = search_enabled ? [{ googleSearch: {} }] : [];

    const genModel = this.genAI.getGenerativeModel({
      model,
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        temperature,
        maxOutputTokens: max_tokens,
        topP: top_p
      },
      tools: tools.length ? tools : undefined
    });

    const lastUserMessage = contents.filter(c => c.role === 'user').pop();
    if (!lastUserMessage) throw new Error('No user message found');

    const historyContents = contents.slice(0, -1);

    const chat = genModel.startChat({
      history: historyContents
    });

    const result = await chat.sendMessage(lastUserMessage.parts[0].text);
    const response = result.response;

    const rawText = response.text();
    const citations = this.extractGroundingMetadata(response);

    return {
      raw_text: rawText,
      model: model,
      usage: {
        prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
        completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata?.totalTokenCount || 0
      },
      finish_reason: response.candidates?.[0]?.finishReason || 'UNKNOWN',
      citations,
      search_performed: search_enabled || false,
      grounding_metadata: response.candidates?.[0]?.groundingMetadata || null,
      raw_response: response
    };
  }

  extractGroundingMetadata(response) {
    const citations = [];
    const metadata = response.candidates?.[0]?.groundingMetadata;

    if (metadata?.groundingChunks) {
      for (const chunk of metadata.groundingChunks) {
        if (chunk.web) {
          citations.push({
            url: chunk.web.uri,
            title: chunk.web.title,
            snippet: null
          });
        }
      }
    }

    if (metadata?.groundingSupports) {
      for (const support of metadata.groundingSupports) {
        if (support.segment && citations.length > 0) {
          const idx = support.groundingChunkIndices?.[0];
          if (idx !== undefined && citations[idx]) {
            citations[idx].snippet = support.segment.text;
          }
        }
      }
    }

    return citations;
  }
}
