import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..', '..');

export class PromptGenerator {
  constructor(config) {
    this.config = config;
    this.personas = config.personas?.personas || [];
    this.entityMaps = config.entityMaps?.entity_maps || {};
    this.turnTypes = config.execution?.multi_turn?.turn_types || [
      'category_discovery', 'feature_deep_dive', 'comparison_analysis',
      'objection_compliance', 'pricing_procurement'
    ];
    this.maxTurns = config.execution?.multi_turn?.max_turns || 5;
    this.minTurns = config.execution?.multi_turn?.min_turns || 3;
  }

  async generateAllPrompts(totalSessions, personaFilter) {
    const sessions = [];
    const personas = personaFilter
      ? this.personas.filter(p => personaFilter.includes(p.persona_id))
      : this.personas;

    if (personas.length === 0) {
      throw new Error('No personas available for prompt generation');
    }

    const sessionsPerPersona = Math.ceil(totalSessions / personas.length);

    for (const persona of personas) {
      const personaSessions = this.generatePersonaSessions(persona, sessionsPerPersona);
      sessions.push(...personaSessions);
    }

    return sessions.slice(0, totalSessions);
  }

  generatePersonaSessions(persona, count) {
    const sessions = [];
    const turnCount = this.randomInt(this.minTurns, this.maxTurns);
    const selectedTurnTypes = this.selectTurnTypes(turnCount);

    for (let i = 0; i < count; i++) {
      const sessionId = uuidv4();
      const turns = [];
      const parameters = this.sampleParameters(persona);

      for (let t = 0; t < selectedTurnTypes.length; t++) {
        const turnType = selectedTurnTypes[t];
        const template = persona.turn_templates?.[turnType] || this.getDefaultTemplate(turnType);
        const prompt = this.interpolateTemplate(template, parameters, persona);

        turns.push({
          turnIndex: t,
          turnType: turnType,
          prompt: prompt,
          parameters: parameters,
          context: null
        });
      }

      sessions.push({
        sessionId,
        personaId: persona.persona_id,
        personaName: persona.display_name,
        buyerStage: persona.buyer_stage,
        vertical: persona.vertical,
        turns,
        metadata: {
          generatedAt: new Date().toISOString(),
          turnCount: turns.length
        }
      });
    }

    return sessions;
  }

  selectTurnTypes(count) {
    const shuffled = [...this.turnTypes].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  sampleParameters(persona) {
    const params = persona.prompt_parameters || {};
    const sampled = {};

    for (const [key, values] of Object.entries(params)) {
      if (Array.isArray(values)) {
        sampled[key] = values[Math.floor(Math.random() * values.length)];
      } else {
        sampled[key] = values;
      }
    }

    const entityMaps = this.entityMaps?.entity_maps || this.entityMaps;
    const brands = entityMaps?.competitors || [];
    const primaryBrand = entityMaps?.your_brand?.primary_name || '';

    sampled.your_brand = primaryBrand;
    sampled.brand_a = primaryBrand;
    if (brands.length > 0) {
      sampled.competitor_1 = brands[0].primary_name;
      sampled.brand_b = brands[0].primary_name;
    }
    if (brands.length > 1) {
      sampled.competitor_2 = brands[1].primary_name;
      sampled.brand_c = brands[1].primary_name;
    }
    if (brands.length > 2) {
      sampled.competitor_3 = brands[2].primary_name;
    }

    sampled.category = entityMaps?.your_brand?.category || '';
    sampled.vertical = persona.vertical || entityMaps?.your_brand?.category || '';

    return sampled;
  }

  interpolateTemplate(template, parameters, persona) {
    let result = template;

    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        result = result.replace(regex, value);
      }
    }

    const entityMaps = this.entityMaps?.entity_maps || this.entityMaps;
    const primaryBrand = entityMaps?.your_brand?.primary_name || '';
    const category = entityMaps?.your_brand?.category || '';
    const defaults = {
      your_brand: primaryBrand,
      brand_a: primaryBrand,
      vertical: persona.vertical || parameters.category || category || 'enterprise software',
      category: parameters.category || category || persona.vertical || 'enterprise software',
      company_size: '500-1000 employees',
      use_case: parameters.category || 'enterprise deployment',
      feature: parameters.category || 'core functionality',
      metric: 'performance benchmarks',
      volume: '1M requests/day',
      deployment_type: 'cloud',
      compliance_requirement: 'SOC2'
    };

    let remainingPlaceholders = result.match(/\{[^}]+\}/g) || [];
    for (const placeholder of remainingPlaceholders) {
      const key = placeholder.slice(1, -1);
      if (defaults[key]) {
        result = result.split(placeholder).join(defaults[key]);
      }
    }

    remainingPlaceholders = result.match(/\{[^}]+\}/g) || [];
    if (remainingPlaceholders.length > 0) {
      const unresolved = [...new Set(remainingPlaceholders.map(p => p.slice(1, -1)))];
      throw new Error(
        `Cannot build prompt for persona "${persona.persona_id}" (${persona.display_name || persona.persona_id}): ` +
        `unresolved placeholders {${unresolved.join('}, {')}} in template "${template}". ` +
        `Add each key to config/personas.json under prompt_parameters (e.g. "${unresolved[0]}": ["some value"]), ` +
        `or define your brand/competitors in config/entity_maps.json.`
      );
    }

    return result;
  }

  getDefaultTemplate(turnType) {
    // Intent -> answer-shape alignment (2026): shortlist for best-X, definition
    // for what-is-X, steps for how-to, PAA/Reddit-style objections for compliance.
    const defaults = {
      category_discovery: 'What are the best {category} solutions for {vertical} companies in 2026? Give a shortlist with one-line reasons.',
      feature_deep_dive: 'How does {brand_a} handle {feature}? Define it in one sentence, then list key technical capabilities as steps.',
      comparison_analysis: 'Compare {brand_a} vs {brand_b} for {use_case}. What are the main differences? End with a verdict for a {company_size} company.',
      objection_compliance: 'What are the known issues, limitations, or compliance concerns with {brand_a}? Cite specific incidents or reviews.',
      pricing_procurement: 'What does {brand_a} cost for a {company_size} company? Break down all fees step by step.'
    };
    return defaults[turnType] || 'Tell me about {brand_a} for {use_case}.';
  }

  /** Fan-out sub-queries Google-style: the follow-ups a complete answer should cover. */
  fanoutSubqueries(prompt) {
    return [
      `${prompt} — what do reviewers on Reddit and G2 say?`,
      `${prompt} — what does official documentation state?`,
      `${prompt} — pricing, limitations, and alternatives?`
    ];
  }

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  exportPrompts(sessions, outputPath) {
    try {
      const dir = dirname(outputPath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(outputPath, JSON.stringify(sessions, null, 2));
      return sessions.length;
    } catch (error) {
      console.error('Failed to export prompts:', error);
      return 0;
    }
  }
}
