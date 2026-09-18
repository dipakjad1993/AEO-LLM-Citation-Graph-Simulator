/**
 * SDK selection: @google/genai (current) preferred, @google/generative-ai (legacy) fallback.
 * Both are normalized to the same result shape by this adapter. Dynamic import keeps
 * offline unit tests + installs without the new SDK working.
 */
let _genaiNew = null;
let _genaiLegacy = null;
async function loadGoogleSdk() {
  if (_genaiNew !== undefined && _genaiLegacy !== undefined && (_genaiNew || _genaiLegacy)) {
    return { New: _genaiNew, Legacy: _genaiLegacy };
  }
  try {
    const mod = await import('@google/genai');
    _genaiNew = mod.GoogleGenAI || null;
  } catch { _genaiNew = null; }
  try {
    const mod = await import('@google/generative-ai');
    _genaiLegacy = mod.GoogleGenerativeAI || null;
  } catch { _genaiLegacy = null; }
  return { New: _genaiNew, Legacy: _genaiLegacy };
}

/**
 * Google 2026: Gemini 2.5/3 groundingMetadata.groundingChunks[].web.uri are
 * GOOGLE REDIRECTS, not publisher URLs. resolveRedirect() follows HEAD so every
 * Gemini citation attributes the real publisher domain. Unresolved URLs are
 * flagged (resolved:false) and excluded from grounded-only SoMV.
 */
export class GoogleProvider {
  constructor(apiKey, config) {
    this.apiKey = apiKey;
    this.config = config;
    this._client = null; // { kind: 'new'|'legacy', client }
  }

  async _clientLazy() {
    if (this._client) return this._client;
    const { New, Legacy } = await loadGoogleSdk();
    if (New) {
      this._client = { kind: 'new', client: new New({ apiKey: this.apiKey }) };
    } else if (Legacy) {
      this._client = { kind: 'legacy', client: new Legacy(this.apiKey) };
    } else {
      throw new Error('No Google SDK installed. Run: npm install @google/genai');
    }
    return this._client;
  }

  async resolveRedirect(url, timeoutMs = 8000) {
    // P0 FIX: HEAD fails with 405/WAF on many publishers -> resolved:false wrongly excluded
    // from SoMV. Fall back to GET with Range:0-0 (1 byte) and follow redirects manually.
    // ENTERPRISE: in-memory cache + resolve timeout metric (Perplexity-style 21.87 cites/answer
    // would otherwise throttle). Persist cache to SQLite in future; TTL 24h here.
    this._resolveCache = this._resolveCache || new Map();
    this._resolveMetrics = this._resolveMetrics || { hits: 0, misses: 0, timeouts: 0, ms_total: 0 };
    const cached = this._resolveCache.get(url);
    if (cached && Date.now() - cached.at < 24 * 3600 * 1000) { this._resolveMetrics.hits++; return cached.value; }
    this._resolveMetrics.misses++;
    const t0 = Date.now();
    const tryFetch = async (method, headers = {}) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers });
        return res.url || url;
      } finally { clearTimeout(t); }
    };
    try {
      let finalUrl = await tryFetch('HEAD');
      if (finalUrl === url) finalUrl = await tryFetch('GET', { Range: 'bytes=0-0' });
      const value = { url: finalUrl, resolved: finalUrl !== url, redirect_chain: finalUrl !== url, resolve_ms: Date.now() - t0 };
      this._resolveMetrics.ms_total += value.resolve_ms;
      if (this._resolveCache.size > 2000) this._resolveCache.delete(this._resolveCache.keys().next().value);
      this._resolveCache.set(url, { at: Date.now(), value });
      return value;
    } catch {
      this._resolveMetrics.timeouts++;
      return { url, resolved: false, redirect_chain: false, resolve_error: true, resolve_ms: Date.now() - t0 };
    }
  }
  async resolveAll(citations, concurrency = 5) {
    // P0 FIX: unbounded Promise.all on dozens of citations = socket exhaustion + 2x cost
    // when the verifier re-fetches. Bounded worker pool + de-dupe by URL first.
    const seen = new Map();
    for (const c of citations) if (!seen.has(c.url)) seen.set(c.url, c);
    const uniq = [...seen.values()];
    const out = new Array(uniq.length);
    let i = 0;
    const worker = async () => {
      while (i < uniq.length) {
        const idx = i++;
        const c = uniq[idx];
        const r = await this.resolveRedirect(c.url);
        out[idx] = { ...c, url: r.url, resolved: r.resolved, raw_uri: c.url !== r.url ? c.url : undefined, resolve_error: r.resolve_error || undefined };
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, uniq.length)) }, worker));
    // Re-expand to original order (deduped entries share the resolved URL).
    const byOrig = new Map(uniq.map((c, k) => [c.url, out[k]]));
    return citations.map(c => byOrig.get(c.url));
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
    const { kind, client } = await this._clientLazy();
    let rawText;
    let grounding = null;
    let usageMetadata = null;
    let finishReason = 'UNKNOWN';
    let rawResponse;
    if (kind === 'new') {
      // @google/genai: ai.models.generateContent({ model, contents, config })
      const tools = search_enabled ? [{ googleSearch: {} }] : undefined;
      const res = await client.models.generateContent({
        model,
        contents: [
          ...(systemInstruction ? [{ role: 'user', parts: [{ text: `[system] ${systemInstruction}` }] }] : []),
          ...contents,
        ],
        config: {
          temperature, maxOutputTokens: max_tokens, topP: top_p,
          ...(tools ? { tools } : {}),
        },
      });
      rawText = res.text || '';
      grounding = res.candidates?.[0]?.groundingMetadata || null;
      usageMetadata = res.usageMetadata || null;
      finishReason = res.candidates?.[0]?.finishReason || 'UNKNOWN';
      rawResponse = res;
    } else {
      const tools = search_enabled ? [{ googleSearch: {} }] : [];
      const genModel = client.getGenerativeModel({
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
      rawText = response.text();
      grounding = response.candidates?.[0]?.groundingMetadata || null;
      usageMetadata = response.usageMetadata || null;
      finishReason = response.candidates?.[0]?.finishReason || 'UNKNOWN';
      rawResponse = response;
    }
    const rawCites = this.extractGroundingMetadata(rawResponse);
    const hiddenQueries = (grounding?.webSearchQueries || []).filter(Boolean);

    let citations = rawCites;
    if (resolve_redirects && citations.length) {
      citations = await this.resolveAll(citations, 5);
    }
    const searchPerformed = citations.length > 0 || Boolean(grounding?.groundingChunks?.length);
    return {
      raw_text: rawText,
      model,
      usage: {
        prompt_tokens: usageMetadata?.promptTokenCount || 0,
        completion_tokens: usageMetadata?.candidatesTokenCount || 0,
        total_tokens: usageMetadata?.totalTokenCount || 0
      },
      finish_reason: finishReason,
      citations,
      sources: citations,
      inline_citations: citations,
      hidden_search_queries: hiddenQueries,
      fanout_queries: hiddenQueries,
      search_performed: Boolean(searchPerformed),
      search_requested: Boolean(search_enabled),
      ungrounded: Boolean(search_enabled) && !searchPerformed,
      grounding_metadata: grounding,
      raw_response: rawResponse
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
