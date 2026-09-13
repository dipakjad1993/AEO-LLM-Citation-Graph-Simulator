/**
 * DemoProvider — keyless synthetic responses for `--demo` / AEO_DEMO_MODE=1.
 * Generates deterministic brand/competitor mentions + citations so the full
 * Python pipeline (SoMV, graphs, CPR, enterprise) runs with zero API keys.
 * NEVER used in real runs: index.js only loads it when no keys are configured.
 */
export class DemoProvider {
  constructor(apiKey, config) {
    this.config = config;
  }

  async chat(messages, options = {}) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const prompt = lastUser?.content || 'demo query';
    const entityMaps = this.config.entityMaps?.entity_maps || this.config.entityMaps || {};
    const brand = entityMaps?.your_brand?.primary_name || 'Acme';
    const comps = (entityMaps?.competitors || []).map(c => c.primary_name).filter(Boolean);
    const c1 = comps[0] || 'RivalOne';
    const c2 = comps[1] || 'RivalTwo';
    const model = options.model || 'demo-model';
    const grounded = options.search_enabled !== false;
    // Deterministic rotation so volatility + multi-model variance is visible
    const h = [...(prompt + model)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const leader = h % 3 === 0 ? brand : h % 3 === 1 ? c1 : c2;
    const rawText = `Based on current reviews and comparisons, ${leader} is the top recommendation for this use case. ` +
      `${brand} is a leading provider with strong documentation and customer reviews. ` +
      `${c1} and ${c2} are widely cited alternatives with competitive pricing. ` +
      `For enterprise deployment, analysts recommend evaluating ${brand} alongside ${c1}.`;
    const citations = grounded ? [
      { url: 'https://www.gartner.com/reviews/demo-category', title: 'Gartner Reviews', snippet: 'analyst review' },
      { url: 'https://www.reddit.com/r/enterprise/demo-thread', title: 'Reddit discussion', snippet: 'user thread' },
      { url: 'https://www.youtube.com/watch?v=demo123', title: 'YouTube review', snippet: 'video review' }
    ] : [];
    return {
      raw_text: rawText,
      model,
      usage: { prompt_tokens: 120, completion_tokens: 180, total_tokens: 300 },
      finish_reason: 'stop',
      citations,
      sources: citations,
      inline_citations: citations.slice(0, 2),
      hidden_search_queries: grounded ? [prompt.slice(0, 80)] : [],
      search_performed: grounded,
      search_requested: Boolean(options.search_enabled),
      ungrounded: !grounded,
      demo_synthetic: true,
      raw_response: { demo: true, prompt }
    };
  }
}
