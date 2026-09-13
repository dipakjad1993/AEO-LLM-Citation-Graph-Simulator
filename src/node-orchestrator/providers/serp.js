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

  async fetchSerp(query, geo) {
    if (!this.apiKey) return { answer: '', citations: [], fanout: [] };
    try {
      if (this.serpProvider === 'serper') {
        const r = await axios.post('https://google.serper.dev/search',
          { q: query, gl: geo, num: 10 },
          { headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' }, timeout: 30000 });
        const d = r.data || {};
        const aio = d.aiOverview?.text || d.answerBox?.snippet || '';
        const citations = [...(d.aiOverview?.references || []), ...(d.organic || [])]
          .map(o => ({ url: o.link || o.url, title: o.title || null, snippet: o.snippet || null }))
          .filter(c => c.url);
        return { answer: aio, citations, fanout: d.relatedSearches?.map(s => s.query).filter(Boolean) || [] };
      }
      if (this.serpProvider === 'dataforseo') {
        const login = process.env.DATAFORSEO_LOGIN || '';
        const r = await axios.post('https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
          [{ keyword: query, location_code: 2840, language_code: 'en', device: 'desktop', os: 'windows' }],
          { auth: { username: login, password: this.apiKey }, timeout: 60000 });
        const items = r.data?.tasks?.[0]?.result?.[0]?.items || [];
        const aio = items.find(i => i.type === 'ai_overview');
        const answer = aio?.text || aio?.snippet || '';
        const citations = items.filter(i => i.url || i.link).map(i => ({ url: i.url || i.link, title: i.title || null, snippet: i.snippet || null }));
        const fanout = items.filter(i => i.type === 'people_also_ask').flatMap(i => (i.items || []).map(x => x.title)).filter(Boolean);
        return { answer, citations, fanout };
      }
      // zenserp generic
      const r = await axios.get('https://app.zenserp.com/api/v2/search',
        { params: { q: query, gl: geo, tbm: 'nws', num: 10 }, headers: { apikey: this.apiKey }, timeout: 30000 });
      const organic = r.data?.organic || [];
      return { answer: '', citations: organic.map(o => ({ url: o.url, title: o.title, snippet: o.description })), fanout: [] };
    } catch {
      return { answer: '', citations: [], fanout: [] };
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
