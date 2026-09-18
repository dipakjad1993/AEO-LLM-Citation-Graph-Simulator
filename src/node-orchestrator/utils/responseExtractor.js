import { v4 as uuidv4 } from 'uuid';

/**
 * ResponseExtractor 2026 — provider-aware citation adapters.
 * - OpenAI Responses: output[].content[].annotations[] (url_citation) + sources[] (full list)
 * - Anthropic: content[] web_search_tool_result -> content[].url, ?utm_source stripped
 * - Gemini: groundingChunks[].web.uri resolved via HEAD (Google redirects)
 * - Perplexity: flat citations[] authoritative
 * Splits `sources` (full bibliography) vs `inline_citations` (claim-anchored).
 * Sentiment here is a fast baseline; deep sentiment runs in Python (transformer when enabled).
 */
export class ResponseExtractor {
  constructor() {
    this.urlRegex = /https?:\/\/[^\s\)\]\>"',;:!?\n\r]+/g;
    this.emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    this.googleRedirectHosts = new Set(['www.google.com', 'google.com', 'vertexaisearch.cloud.google.com']);
  }

  extract(rawResponse, context) {
    if (!rawResponse || !rawResponse.raw_text) {
      return {
        executionId: context.executionId, success: false, error: 'Empty response',
        raw_text: '', citations: [], sources: [], inline_citations: [],
        entities: [], metadata: {},
        search_performed: false, search_requested: Boolean(context.ragEnabled),
        ungrounded: Boolean(context.ragEnabled), grounding: 'missing_response'
      };
    }
    const rawText = rawResponse.raw_text;
    const adapter = this.citationAdapter(rawResponse, context);
    const explicitCitations = this.extractExplicitCitations(rawResponse, context);
    const implicitCitations = this.extractImplicitCitations(rawText, explicitCitations);
    const allCitations = [...explicitCitations, ...implicitCitations];
    const dedupedCitations = this.deduplicateCitations(allCitations);
    const sources = rawResponse.sources?.length ? this.deduplicateCitations(rawResponse.sources.map(s => this.normalize(s, 'source_list'))) : dedupedCitations;
    const inline = rawResponse.inline_citations?.length ? this.deduplicateCitations(rawResponse.inline_citations.map(s => this.normalize(s, 'inline'))) : dedupedCitations.filter(c => c.type === 'explicit');
    const entities = this.extractEntities(rawText, context);
    const sentiment = this.analyzeSentimentBaseline(rawText, entities);
    const triples = this.extractTriples(rawText, entities);
    const domMetadata = rawResponse.dom_extracted_metadata || {};

    const searchRequested = rawResponse.search_requested ?? Boolean(context.ragEnabled);
    const searchPerformed = Boolean(rawResponse.search_performed) && dedupedCitations.length > 0
      ? true : Boolean(rawResponse.search_performed);
    // FACT check: requested browsing but zero citations + zero grounding metadata = memory answer
    const evidenceOfBrowse = dedupedCitations.length > 0 || (rawResponse.hidden_search_queries?.length > 0) || Boolean(rawResponse.grounding_metadata);
    const grounded = searchPerformed && evidenceOfBrowse;
    const ungrounded = searchRequested && !grounded;

    return {
      executionId: context.executionId, success: true,
      promptSessionId: context.promptSession?.sessionId,
      personaId: context.promptSession?.personaId,
      modelId: context.modelId, turnIndex: context.turnIndex, turnType: context.turn?.turnType,
      ragEnabled: context.ragEnabled, raw_text: rawText,
      citations: dedupedCitations, citationCount: dedupedCitations.length,
      sources, inline_citations: inline,
      citation_adapter: adapter,
      google_redirects_unresolved: dedupedCitations.filter(c => this.isGoogleRedirect(c.url) && !c.resolved).length,
      entities, sentiment, triples,
      dom_metadata: domMetadata, usage: rawResponse.usage || {},
      search_performed: grounded,
      search_requested: searchRequested,
      ungrounded,
      grounding: grounded ? 'grounded' : searchRequested ? 'ungrounded_memory' : 'base_weights',
      hidden_search_queries: rawResponse.hidden_search_queries || [],
      fanout_queries: rawResponse.fanout_queries || [],
      serp_surface: rawResponse.serp_surface || null,
      finish_reason: rawResponse.finish_reason,
      timestamp: new Date().toISOString()
    };
  }

  citationAdapter(rawResponse, context) {
    const mid = (context.modelId || '').toLowerCase();
    if (mid.includes('gpt') || mid.includes('openai')) return 'openai_responses_annotations';
    if (mid.includes('claude') || mid.includes('anthropic')) return 'anthropic_web_search_tool_result';
    if (mid.includes('gemini')) return 'gemini_grounding_chunks_resolve_redirect';
    if (mid.includes('sonar') || mid.includes('perplexity')) return 'perplexity_citations_flat';
    if (mid.includes('grok')) return 'openai_chat_annotations';
    if (mid.includes('copilot') || mid.includes('ai-overview') || mid.includes('ai-mode')) return 'serp_organic_results';
    return 'generic';
  }

  normalize(c, type = 'explicit') {
    return {
      citationId: uuidv4(), url: c.url, title: c.title || null,
      anchor_text: c.snippet || c.anchor_text || null, type,
      source: c.fallback ? 'text_fallback' : 'api_response', confidence: c.fallback ? 0.6 : 1.0,
      resolved: c.resolved, raw_uri: c.raw_uri, index: c.index
    };
  }

  extractExplicitCitations(rawResponse, context) {
    const citations = rawResponse.citations || [];
    return citations.map(c => this.normalize(c, 'explicit'));
  }

  extractImplicitCitations(rawText, alreadyHave) {
    const have = new Set((alreadyHave || []).map(c => c.url?.toLowerCase().replace(/\/+$/, '')));
    const implicit = [];
    for (const url of rawText.match(this.urlRegex) || []) {
      const clean = this.cleanUrl(url);
      if (this.isValidUrl(clean) && !have.has(clean.toLowerCase().replace(/\/+$/, ''))) {
        implicit.push({ citationId: uuidv4(), url: clean, title: null, anchor_text: null, type: 'implicit', source: 'text_parsing', confidence: 0.6 });
        have.add(clean.toLowerCase().replace(/\/+$/, ''));
      }
    }
    return implicit;
  }

  cleanUrl(url) {
    let clean = url.replace(/[.,;:!?)]+$/, '');
    try {
      const u = new URL(clean);
      // UTM-strip on ALL adapters (not just Anthropic) + canonicalization:
      // lowercase host, strip www., drop fragment, drop trailing slash (root kept as /).
      for (const k of [...u.searchParams.keys()]) {
        if (/^utm_/i.test(k) || ['gclid', 'fbclid', 'msclkid', 'yclid'].includes(k.toLowerCase())) u.searchParams.delete(k);
      }
      u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
      u.hash = '';
      let p = u.pathname.replace(/\/+$/, '');
      u.pathname = p || '/';
      clean = u.toString();
    } catch { /* keep as-is */ }
    return clean;
  }

  isGoogleRedirect(url) {
    try { return this.googleRedirectHosts.has(new URL(url).hostname.toLowerCase()); }
    catch { return false; }
  }

  isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.');
    } catch { return false; }
  }

  deduplicateCitations(citations) {
    const seen = new Map();
    for (const citation of citations) {
      if (!citation?.url) continue;
      // canonical key: www-stripped, lowercased, no trailing slash (matches cleanUrl)
      let key = citation.url;
      try {
        const u = new URL(citation.url);
        u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
        u.hash = '';
        key = u.toString().replace(/\/+$/, '').toLowerCase();
      } catch { key = citation.url.toLowerCase().replace(/\/+$/, ''); }
      if (!seen.has(key)) seen.set(key, citation);
      else if (citation.confidence > seen.get(key).confidence) seen.set(key, citation);
    }
    return [...seen.values()];
  }

  extractEntities(rawText, context) {
    const entities = [];
    const entityConfig = context.entityConfig || {};
    const yourBrand = entityConfig.your_brand || {};
    const competitors = entityConfig.competitors || [];
    const authoritySources = entityConfig.external_authority_sources || [];
    const configuredBrands = [];
    if (yourBrand.primary_name) configuredBrands.push(yourBrand.primary_name);
    for (const comp of competitors) {
      if (comp.primary_name) configuredBrands.push(comp.primary_name);
    }
    for (const brand of configuredBrands) {
      const escaped = this.escapeRegExp(brand).replace(/ /g, '[ _-]?');
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      const matches = rawText.match(regex);
      if (matches) {
        entities.push({
          name: brand, canonical_name: brand.toLowerCase().replace(/\s+/g, '_'),
          count: matches.length, type: brand === yourBrand.primary_name ? 'your_brand' : 'competitor',
          positions: this.findPositions(rawText, regex)
        });
      }
    }
    // Aliases count toward the same brand
    for (const alias of yourBrand.aliases || []) {
      const regex = new RegExp(`\\b${this.escapeRegExp(alias).replace(/ /g, '[ _-]?')}\\b`, 'gi');
      const matches = rawText.match(regex);
      if (matches) {
        const existing = entities.find(e => e.name === yourBrand.primary_name);
        if (existing) existing.count += matches.length;
      }
    }
    if (yourBrand.attributes?.features) {
      for (const feature of yourBrand.attributes.features) {
        const escaped = this.escapeRegExp(feature).replace(/(\s|-)/g, '[ -_]?');
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        const matches = rawText.match(regex);
        if (matches) entities.push({ name: feature, canonical_name: feature.toLowerCase(), count: matches.length, type: 'feature' });
      }
    }
    for (const source of authoritySources) {
      if (source.domain) {
        const domainName = source.domain.replace(/\.(com|org|io|net)$/i, '');
        const regex = new RegExp(`\\b${this.escapeRegExp(domainName)}\\b`, 'gi');
        const matches = rawText.match(regex);
        if (matches) entities.push({ name: source.domain, canonical_name: source.domain, count: matches.length, type: 'source' });
      }
    }
    return entities;
  }

  escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  findPositions(text, regex) {
    const positions = [];
    let match;
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    while ((match = globalRegex.exec(text)) !== null) {
      positions.push({ start: match.index, end: match.index + match[0].length });
    }
    return positions;
  }

  /** Fast regex baseline. Labelled as such — deep transformer sentiment runs in Python. */
  analyzeSentimentBaseline(rawText, entities) {
    const sentiment = { overall: 'neutral', method: 'regex_baseline', entities: {} };
    const positivePatterns = [
      /\b(excellent|best|leading|top|innovative|powerful|reliable|trusted|recommended|outstanding|superior|market leader)\b/gi,
      /\b(strength|advantage|superior|outperform|ahead|robust|seamless)\b/gi,
      /\b(Gartner.*leader|Forrester.*leader|top.*choice|customers love)\b/gi
    ];
    const negativePatterns = [
      /\b(lacks|missing|weakness|problem|issue|concern|complaint|failure|limitation|drawback)\b/gi,
      /\b(expensive|overpriced|difficult|complex|complicated|slow|buggy)\b/gi,
      /\b(outage|downtime|breach|incident|vulnerability|lawsuit)\b/gi
    ];
    for (const entity of entities.filter(e => e.type === 'your_brand' || e.type === 'competitor')) {
      const name = entity.name;
      const regex = new RegExp(`[^.!?]*\\b${this.escapeRegExp(name).replace(/ /g, '[ _-]?')}\\b[^.!?]*[.!?]`, 'gi');
      const sentences = rawText.match(regex) || [];
      let positiveCount = 0; let negativeCount = 0;
      for (const sentence of sentences) {
        for (const pattern of positivePatterns) positiveCount += (sentence.match(pattern) || []).length;
        for (const pattern of negativePatterns) negativeCount += (sentence.match(pattern) || []).length;
      }
      const total = positiveCount + negativeCount || 1;
      sentiment.entities[name] = {
        positive: positiveCount, negative: negativeCount,
        score: (positiveCount - negativeCount) / total,
        label: positiveCount > negativeCount ? 'positive' : negativeCount > positiveCount ? 'negative' : 'neutral'
      };
    }
    return sentiment;
  }

  extractTriples(rawText, entities) {
    const triples = [];
    const brandEntities = entities.filter(e => e.type === 'your_brand' || e.type === 'competitor');
    const patterns = [
      { regex: /(\w[\w\s]*)\s+(provides?|offers?|includes?|supports?|features?|delivers?)\s+([\w\s]+)/gi, sentiment: 'positive' },
      { regex: /(\w[\w\s]*)\s+(lacks?|missing|doesn't have|without|no)\s+([\w\s]+)/gi, sentiment: 'negative' },
      { regex: /(\w[\w\s]*)\s+(is|are)\s+(better|worse|faster|slower|cheaper|more expensive)\s+(than|compared)\s+([\w\s]+)/gi, sentiment: 'comparative' },
      { regex: /(\w[\w\s]*)\s+(uses?|utilizes?|employs?|relies? on)\s+([\w\s]+)/gi, sentiment: 'neutral' }
    ];
    for (const brand of brandEntities) {
      for (const pattern of patterns) {
        const brandRegex = new RegExp(pattern.regex.source.replace(/(\w[\w\s]*)/, `(${this.escapeRegExp(brand.name)}[\\w\\s]*)`), pattern.regex.flags);
        let match;
        while ((match = brandRegex.exec(rawText)) !== null) {
          triples.push({ subject: match[1].trim(), predicate: match[2].trim(), object: match[3].trim(), sentiment: pattern.sentiment, source_text: match[0], confidence: 0.75, brand: brand.name });
        }
      }
    }
    return triples.slice(0, 50);
  }
}
