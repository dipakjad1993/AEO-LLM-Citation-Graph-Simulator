import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Google 2026: Gemini 2.5/3 groundingMetadata.groundingChunks[].web.uri are
 * GOOGLE REDIRECTS, not publisher URLs. resolveRedirect() follows HEAD so every
 * Gemini citation attributes the real publisher domain. Unresolved URLs are
 * flagged (resolved:false) and excluded from grounded-only SoMV.
 */
export class GoogleProvider {
  constructor(apiKey, config) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.config = config;
  }

  async resolveRedirect(url, timeoutMs = 8000) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
      clearTimeout(t);
      const finalUrl = res.url || url;
      return { url: finalUrl, resolved: finalUrl !== url, redirect_chain: finalUrl !== url };
    } catch {
      return { url, resolved: false, redirect_chain: false };
    }
  }

  async chat(messages, options = {}) {
    const { model = 'gemini-2.5-pro', temperature = 0.15, max_tokens = 4096, top_p = 0.9, search_enabled, resolve_redirects = true } = options;

    let systemInstruction = '';
    const contents = [];
    for (const msg of messages) {
      if (msg.role === 'system') systemInstruction = msg.content;
      else if (msg.role === 'user') contents.push({ role: 'user', parts: [{ text: msg.content }] });
      else if (msg.role === 'assistant') contents.push({ role: 'model', parts: [{ text: msg.content }] });
    }
    const tools = search_enabled ? [{ googleSearch: {} }] : [];
    const genModel = this.genAI.getGenerativeModel({
      model,
      systemInstruction: systemInstruction || undefined,
      generationConfig: { temperature, maxOutputTokens: max_tokens, topP: top_p },
      tools: tools.length ? tools : undefined
    });
    const lastUserMessage = contents.filter(c => c.role === 'user').pop();
    if (!lastUserMessage) throw new Error('No user message found');
    const chat = genModel.startChat({ history: contents.slice(0, -1) });
    const result = await chat.sendMessage(lastUserMessage.parts[0].text);
    const response = result.response;
    const rawText = response.text();
    const grounding = response.candidates?.[0]?.groundingMetadata || null;
    const rawCites = this.extractGroundingMetadata(response);
    const hiddenQueries = (grounding?.webSearchQueries || []).filter(Boolean);

    let citations = rawCites;
    if (resolve_redirects && citations.length) {
      citations = await Promise.all(citations.map(async c => {
        const r = await this.resolveRedirect(c.url);
        return { ...c, url: r.url, resolved: r.resolved, raw_uri: c.url !== r.url ? c.url : undefined };
      }));
    }
    const searchPerformed = citations.length > 0 || Boolean(grounding?.groundingChunks?.length);
    return {
      raw_text: rawText,
      model,
      usage: {
        prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
        completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata?.totalTokenCount || 0
      },
      finish_reason: response.candidates?.[0]?.finishReason || 'UNKNOWN',
      citations,
      sources: citations,
      inline_citations: citations,
      hidden_search_queries: hiddenQueries,
      fanout_queries: hiddenQueries,
      search_performed: Boolean(searchPerformed),
      search_requested: Boolean(search_enabled),
      ungrounded: Boolean(search_enabled) && !searchPerformed,
      grounding_metadata: grounding,
      raw_response: response
    };
  }

  extractGroundingMetadata(response) {
    const citations = [];
    const metadata = response.candidates?.[0]?.groundingMetadata;
    if (metadata?.groundingChunks) {
      for (const chunk of metadata.groundingChunks) {
        if (chunk.web?.uri) citations.push({ url: chunk.web.uri, title: chunk.web.title || null, snippet: null, needs_redirect_resolution: true });
      }
    }
    if (metadata?.groundingSupports) {
      for (const support of metadata.groundingSupports) {
        if (support.segment && citations.length > 0) {
          const idx = support.groundingChunkIndices?.[0];
          if (idx !== undefined && citations[idx]) citations[idx].snippet = support.segment.text;
        }
      }
    }
    return citations;
  }
}
