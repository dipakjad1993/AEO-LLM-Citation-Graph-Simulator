import { v4 as uuidv4 } from 'uuid';

export class ResponseExtractor {
  constructor() {
    this.urlRegex = /https?:\/\/[^\s\)\]\>"',;:!?\n\r]+/g;
    this.emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    this.brandPatternCache = {};
  }

  extract(rawResponse, context) {
    if (!rawResponse || !rawResponse.raw_text) {
      return {
        executionId: context.executionId,
        success: false,
        error: 'Empty response',
        raw_text: '',
        citations: [],
        entities: [],
        metadata: {}
      };
    }

    const rawText = rawResponse.raw_text;
    const explicitCitations = this.extractExplicitCitations(rawResponse, context);
    const implicitCitations = this.extractImplicitCitations(rawText);
    const allCitations = [...explicitCitations, ...implicitCitations];
    const dedupedCitations = this.deduplicateCitations(allCitations);

    const entities = this.extractEntities(rawText, context);
    const sentiment = this.analyzeSentiment(rawText, entities);
    const triples = this.extractTriples(rawText, entities);
    const domMetadata = rawResponse.dom_extracted_metadata || {};

    return {
      executionId: context.executionId,
      success: true,
      promptSessionId: context.promptSession?.sessionId,
      personaId: context.promptSession?.personaId,
      modelId: context.modelId,
      turnIndex: context.turnIndex,
      turnType: context.turn?.turnType,
      ragEnabled: context.ragEnabled,
      raw_text: rawText,
      citations: dedupedCitations,
      citationCount: dedupedCitations.length,
      entities,
      sentiment,
      triples,
      dom_metadata: domMetadata,
      usage: rawResponse.usage || {},
      search_performed: rawResponse.search_performed || false,
      finish_reason: rawResponse.finish_reason,
      timestamp: new Date().toISOString()
    };
  }

  extractExplicitCitations(rawResponse, context) {
    const citations = rawResponse.citations || [];
    return citations.map(c => ({
      citationId: uuidv4(),
      url: c.url,
      title: c.title || null,
      anchor_text: c.snippet || c.anchor_text || null,
      type: 'explicit',
      source: 'api_response',
      confidence: 1.0
    }));
  }

  extractImplicitCitations(rawText) {
    const implicit = [];
    const urls = rawText.match(this.urlRegex) || [];

    for (const url of urls) {
      const cleanUrl = url.replace(/[.,;:!?)]+$/, '');
      if (this.isValidUrl(cleanUrl)) {
        implicit.push({
          citationId: uuidv4(),
          url: cleanUrl,
          title: null,
          anchor_text: null,
          type: 'implicit',
          source: 'text_parsing',
          confidence: 0.8
        });
      }
    }

    return implicit;
  }

  isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.');
    } catch {
      return false;
    }
  }

  deduplicateCitations(citations) {
    const seen = new Map();
    for (const citation of citations) {
      const normalizedUrl = citation.url.toLowerCase().replace(/\/+$/, '');
      if (!seen.has(normalizedUrl)) {
        seen.set(normalizedUrl, citation);
      } else {
        const existing = seen.get(normalizedUrl);
        if (citation.confidence > existing.confidence) {
          seen.set(normalizedUrl, citation);
        }
      }
    }
    return Array.from(seen.values());
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
          name: brand,
          canonical_name: brand.toLowerCase().replace(/\s+/g, '_'),
          count: matches.length,
          type: brand === yourBrand.primary_name ? 'your_brand' : 'competitor',
          positions: this.findPositions(rawText, regex)
        });
      }
    }

    if (yourBrand.attributes?.features) {
      for (const feature of yourBrand.attributes.features) {
        const escaped = this.escapeRegExp(feature).replace(/(\s|-)/g, '[ -_]?');
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        const matches = rawText.match(regex);
        if (matches) {
          entities.push({
            name: feature,
            canonical_name: feature.toLowerCase(),
            count: matches.length,
            type: 'feature'
          });
        }
      }
    }

    for (const source of authoritySources) {
      if (source.domain) {
        const domainName = source.domain.replace(/\.(com|org|io|net)$/i, '');
        const regex = new RegExp(`\\b${this.escapeRegExp(domainName)}\\b`, 'gi');
        const matches = rawText.match(regex);
        if (matches) {
          entities.push({
            name: source.domain,
            canonical_name: source.domain,
            count: matches.length,
            type: 'source'
          });
        }
      }
    }

    return entities;
  }

  escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  findPositions(text, regex) {
    const positions = [];
    let match;
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    while ((match = globalRegex.exec(text)) !== null) {
      positions.push({ start: match.index, end: match.index + match[0].length });
    }
    return positions;
  }

  analyzeSentiment(rawText, entities) {
    const sentiment = { overall: 'neutral', entities: {} };

    const positivePatterns = [
      /\b(excellent|best|leading|top|innovative|powerful|reliable|trusted|recommended)\b/gi,
      /\b(strength|advantage|superior|outperform|ahead)\b/gi,
      /\b(Gartner.*leader|Forrester.*leader|top.*choice)\b/gi
    ];

    const negativePatterns = [
      /\b(lacks|missing|weakness|problem|issue|concern|complaint|failure)\b/gi,
      /\b(expensive|overpriced|difficult|complex|complicated)\b/gi,
      /\b(outage|downtime|breach|incident|vulnerability)\b/gi
    ];

    for (const entity of entities.filter(e => e.type === 'your_brand' || e.type === 'competitor')) {
      const name = entity.name;
      const regex = new RegExp(`[^.!?]*\\b${this.escapeRegExp(name).replace(/ /g, '[ _-]?')}\\b[^.!?]*[.!?]`, 'gi');
      const sentences = rawText.match(regex) || [];

      let positiveCount = 0;
      let negativeCount = 0;

      for (const sentence of sentences) {
        for (const pattern of positivePatterns) {
          positiveCount += (sentence.match(pattern) || []).length;
        }
        for (const pattern of negativePatterns) {
          negativeCount += (sentence.match(pattern) || []).length;
        }
      }

      const total = positiveCount + negativeCount || 1;
      sentiment.entities[name] = {
        positive: positiveCount,
        negative: negativeCount,
        score: (positiveCount - negativeCount) / total,
        label: positiveCount > negativeCount ? 'positive' : negativeCount > positiveCount ? 'negative' : 'neutral'
      };
    }

    return sentiment;
  }

  extractTriples(rawText, entities) {
    const triples = [];
    const brandEntities = entities.filter(e => e.type === 'your_brand' || e.type === 'competitor');
    const featureEntities = entities.filter(e => e.type === 'feature');

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
          triples.push({
            subject: match[1].trim(),
            predicate: match[2].trim(),
            object: match[3].trim(),
            sentiment: pattern.sentiment,
            source_text: match[0],
            confidence: 0.75,
            brand: brand.name
          });
        }
      }
    }

    return triples.slice(0, 50);
  }
}
