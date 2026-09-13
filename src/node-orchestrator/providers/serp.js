import axios from 'axios';

/**
 * Copilot / Google-AIO SERP collector (2026).
 * Chat APIs cannot see AI Overviews / AI Mode / Copilot answers, so this
 * provider wraps a SERP API (DataForSEO, Serper, or Zenserp) and normalizes
 * organic + AIO citations into the standard provider result shape.
 * Configure SERP_API_KEY + SERP_PROVIDER env vars.
 */
export class SerpProvider {
  constructor(apiKey, config, kind = 'ai-overviews') {
    this.apiKey = apiKey;
    this.config = config;
    this.kind = kind;
    this.serpProvider = (process.env.SERP_PROVIDER || 'serper').toLowerCase();
  }

  async chat(messages, options = {}) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const query = lastUser?.content || '';
    const geo = options.geo || process.env.SERP_GEO || 'us';
    const { answer, citations, fanout } = await this.fetchSerp(query, geo);
    return {
      raw_text: answer,
      model: this.kind === 'copilot-serp' ? 'copilot-serp' : this.kind === 'ai-mode' ? 'google-ai-mode' : 'google-ai-overviews',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: 'serp_complete',
      citations,
      sources: citations,
      inline_citations: citations,
      hidden_search_queries: fanout,
      fanout_queries: fanout,
      search_performed: true,
      search_requested: true,
      ungrounded: false,
      serp_surface: this.kind,
      raw_response: { query, citations, fanout }
    };
  }

  static LOCATION_CODES = { us: 2840, uk: 2826, ca: 2124, au: 2036, de: 2276, fr: 2250, in: 2356, es: 2724, it: 2380, nl: 2528, br: 2076, jp: 2392 };
  async fetchSerp(query, geo) {
    if (!this.apiKey) return { answer: '', citations: [], fanout: [] };
    const logErr = (provider, err) => console.warn(`[SERP:${provider}] fetch failed for "${String(query).slice(0, 80)}": ${err?.response?.status || ''} ${err?.message || err}`);
    try {
      if (this.serpProvider === 'serper') {
        // P0 FIX: pass hl + location context; serper gl expects lowercase country code.
        const r = await axios.post('https://google.serper.dev/search',
          { q: query, gl: String(geo || 'us').toLowerCase(), hl: 'en', num: 10 },
          { headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' }, timeout: 30000 });
        const d = r.data || {};
        const aio = d.aiOverview?.text || d.answerBox?.snippet || '';
        const citations = [...(d.aiOverview?.references || []), ...(d.organic || [])]
          .map(o => ({ url: o.link || o.url, title: o.title || null, snippet: o.snippet || null }))
          .filter(c => c.url);
        return { answer: aio, citations, fanout: d.relatedSearches?.map(s => s.query).filter(Boolean) || [] };
      }
      if (this.serpProvider === 'dataforseo') {
        // P0 FIX: 2840 is US-only. Map geo->location_code so multi-country runs work.
        const login = process.env.DATAFORSEO_LOGIN || '';
        const loc = SerpProvider.LOCATION_CODES[String(geo || 'us').toLowerCase()] || 2840;
        const r = await axios.post('https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
          [{ keyword: query, location_code: loc, language_code: 'en', device: 'desktop', os: 'windows' }],
          { auth: { username: login, password: this.apiKey }, timeout: 60000 });
        const items = r.data?.tasks?.[0]?.result?.[0]?.items || [];
        const aio = items.find(i => i.type === 'ai_overview');
        const answer = aio?.text || aio?.snippet || '';
        const citations = items.filter(i => i.url || i.link).map(i => ({ url: i.url || i.link, title: i.title || null, snippet: i.snippet || null }));
        const fanout = items.filter(i => i.type === 'people_also_ask').flatMap(i => (i.items || []).map(x => x.title)).filter(Boolean);
        return { answer, citations, fanout };
      }
      // zenserp generic
      // P0 FIX: tbm:nws is the NEWS vertical — wrong for AIO/AI-Mode answers. Drop it so we
      // get the default web vertical (+ AIO where Zenserp exposes it).
      const r = await axios.get('https://app.zenserp.com/api/v2/search',
        { params: { q: query, gl: geo, hl: 'en', num: 10 }, headers: { apikey: this.apiKey }, timeout: 30000 });
      const organic = r.data?.organic || [];
      const aioText = r.data?.ai_overview?.text || r.data?.answer_box?.snippet || '';
      return { answer: aioText, citations: organic.map(o => ({ url: o.url, title: o.title, snippet: o.description })).filter(c => c.url), fanout: [] };
    } catch (err) {
      // P0 FIX: silent catch{} hid total data loss. Log with status, return typed empty.
      const sp = this.serpProvider;
      console.warn(`[SERP:${sp}] fetch failed: ${err?.response?.status || ''} ${err?.message || err}`);
      return { answer: '', citations: [], fanout: [], serp_error: String(err?.message || err) };
    }
  }
}

export class CopilotProvider extends SerpProvider {
  constructor(apiKey, config) { super(apiKey, config, 'copilot-serp'); }
}
export class AIOverviewsProvider extends SerpProvider {
  constructor(apiKey, config) { super(apiKey, config, 'ai-overviews'); }
}
export class AIModeProvider extends SerpProvider {
  constructor(apiKey, config) { super(apiKey, config, 'ai-mode'); }
}
