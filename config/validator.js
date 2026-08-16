/**
 * AEO Citation Graph Simulator - Configuration Validator
 * Fails fast with precise, actionable errors before any API call is made.
 * Validates every config file against an explicit schema and the runtime
 * environment (API keys, required directories).
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

export class ConfigError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

const PROVIDER_API_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_AI_API_KEY',
  'PERPLEXITY_API_KEY',
  'DEEPSEEK_API_KEY'
];

const PLACEHOLDER_PATTERNS = [
  'sk-your-', 'sk-ant-your-', 'pplx-your-', 'your-', 'your-key', 'changeme', 'xxx'
];

// Mirrors src/node-orchestrator/utils/promptGenerator.js runtime defaults so
// template placeholders that resolve at prompt-build time are not false failures.
const DEFAULT_PLACEHOLDERS = {
  vertical: 'enterprise software',
  category: 'enterprise software',
  company_size: '500-1000 employees',
  use_case: 'enterprise deployment',
  feature: 'core functionality',
  metric: 'performance benchmarks',
  volume: '1M requests/day',
  deployment_type: 'cloud',
  compliance_requirement: 'SOC2'
};

function validateModels(models) {
  const errors = [];
  if (!models || typeof models !== 'object') {
    return ['models.json: "models" must be an object keyed by provider'];
  }
  for (const [provider, providerModels] of Object.entries(models.models || {})) {
    if (typeof providerModels !== 'object' || !providerModels) {
      errors.push(`models.json: provider "${provider}" must be an object of models`);
      continue;
    }
    for (const [modelId, modelConfig] of Object.entries(providerModels)) {
      if (!modelConfig || typeof modelConfig !== 'object') {
        errors.push(`models.json: model "${provider}.${modelId}" must be an object`);
        continue;
      }
      if (!modelConfig.model_id) errors.push(`models.json: "${provider}.${modelId}" missing "model_id"`);
      if (typeof modelConfig.cost_per_1k_input !== 'number') errors.push(`models.json: "${provider}.${modelId}" missing numeric "cost_per_1k_input"`);
      if (typeof modelConfig.cost_per_1k_output !== 'number') errors.push(`models.json: "${provider}.${modelId}" missing numeric "cost_per_1k_output"`);
      if (Array.isArray(modelConfig.temperature_range) && modelConfig.temperature_range.length === 2) {
        const [min, max] = modelConfig.temperature_range;
        if (min > max) errors.push(`models.json: "${provider}.${modelId}" temperature_range min > max`);
      }
    }
  }
  return errors;
}

function validateEntityConfig(entityMaps) {
  const errors = [];
  if (!entityMaps || typeof entityMaps !== 'object') {
    return ['entity_maps.json: "entity_maps" object is required'];
  }
  const yourBrand = entityMaps.your_brand || {};
  if (!yourBrand.primary_name || typeof yourBrand.primary_name !== 'string') {
    errors.push('entity_maps.json: your_brand.primary_name is required (your real brand name)');
  }
  if (yourBrand.website && !/^https?:\/\//.test(yourBrand.website)) {
    errors.push(`entity_maps.json: your_brand.website "${yourBrand.website}" must be an http(s) URL`);
  }
  const competitors = Array.isArray(entityMaps.competitors) ? entityMaps.competitors : [];
  if (competitors.length === 0) {
    errors.push('entity_maps.json: at least one competitor is required (your real competitors)');
  }
  for (const [i, comp] of competitors.entries()) {
    if (!comp?.primary_name) errors.push(`entity_maps.json: competitor[${i}] missing "primary_name"`);
    if (comp?.website && !/^https?:\/\//.test(comp.website)) {
      errors.push(`entity_maps.json: competitor "${comp.primary_name}" website must be an http(s) URL`);
    }
  }
  if (competitors.some(c => c?.primary_name === yourBrand.primary_name)) {
    errors.push('entity_maps.json: a competitor cannot have the same name as your_brand');
  }
  const authoritySources = Array.isArray(entityMaps.external_authority_sources) ? entityMaps.external_authority_sources : [];
  for (const [i, src] of authoritySources.entries()) {
    if (!src?.domain) errors.push(`entity_maps.json: external_authority_sources[${i}] missing "domain"`);
    if (src && typeof src.authority_weight !== 'number') {
      errors.push(`entity_maps.json: external_authority_sources[${i}] missing numeric "authority_weight"`);
    }
  }
  return errors;
}

function validateExecution(execution) {
  const errors = [];
  if (!execution || typeof execution !== 'object') {
    return ['execution.json: "execution" object is required'];
  }
  if (!Array.isArray(execution.modes) || !execution.modes.includes(execution.mode)) {
    errors.push(`execution.json: mode "${execution.mode}" must be one of [${(execution.modes || []).join(', ')}]`);
  }
  if (typeof execution.playwright_sample_rate !== 'number' ||
      execution.playwright_sample_rate < 0 || execution.playwright_sample_rate > 1) {
    errors.push('execution.json: playwright_sample_rate must be a number in [0, 1]');
  }
  if (!Number.isInteger(execution.max_concurrent_api) || execution.max_concurrent_api < 1) {
    errors.push('execution.json: max_concurrent_api must be a positive integer');
  }
  const retry = execution.retry || {};
  if (!Number.isInteger(retry.attempts) || retry.attempts < 0) {
    errors.push('execution.json: retry.attempts must be a non-negative integer');
  }
  return errors;
}

function validatePersonas(personasConfig) {
  const errors = [];
  const personas = Array.isArray(personasConfig?.personas) ? personasConfig.personas : [];
  if (personas.length === 0) {
    errors.push('personas.json: at least one persona is required');
    return errors;
  }
  const ids = new Set();
  for (const [i, persona] of personas.entries()) {
    if (!persona?.persona_id) errors.push(`personas.json: persona[${i}] missing "persona_id"`);
    if (ids.has(persona?.persona_id)) errors.push(`personas.json: duplicate persona_id "${persona.persona_id}"`);
    ids.add(persona?.persona_id);
    if (!persona?.turn_templates || typeof persona.turn_templates !== 'object') {
      errors.push(`personas.json: persona "${persona?.persona_id || i}" missing "turn_templates"`);
    }
    const params = persona?.prompt_parameters || {};
    const templates = persona?.turn_templates || {};
    for (const [turnType, template] of Object.entries(templates)) {
      const placeholders = [...new Set((String(template).match(/\{([^}]+)\}/g) || []).map(p => p.slice(1, -1)))];
      for (const key of placeholders) {
        const param = params[key];
        const paramResolvable = param !== undefined && param !== '' &&
          (!Array.isArray(param) || param.length > 0);
        const brandResolvable = ['your_brand', 'brand_a', 'competitor_1', 'brand_b',
          'competitor_2', 'brand_c', 'competitor_3'].includes(key);
        if (!paramResolvable && !brandResolvable && !(key in DEFAULT_PLACEHOLDERS)) {
          errors.push(`personas.json: persona "${persona?.persona_id || i}" template "${turnType}" uses {${key}} with no values in prompt_parameters`);
        }
      }
    }
  }
  return errors;
}

function hasValidApiKey(env) {
  for (const key of PROVIDER_API_KEYS) {
    const value = (env[key] || '').trim();
    if (!value) continue;
    const lower = value.toLowerCase();
    const isPlaceholder = PLACEHOLDER_PATTERNS.some(p => lower.includes(p.toLowerCase()));
    if (!isPlaceholder && value.length >= 10) return true;
  }
  return false;
}

export function validateAllConfigs({ env = process.env, requireKeys = true, configDir = join(ROOT_DIR, 'config') } = {}) {
  const errors = [];
  const files = ['models.json', 'execution.json', 'analytics.json', 'personas.json', 'entity_maps.json'];

  for (const file of files) {
    const filepath = join(configDir, file);
    if (!existsSync(filepath)) {
      errors.push(`Missing config file: ${filepath}`);
      continue;
    }
    try {
      JSON.parse(readFileSync(filepath, 'utf8'));
    } catch (e) {
      errors.push(`${file} is not valid JSON: ${e.message}`);
    }
  }

  const parse = (file) => {
    try { return JSON.parse(readFileSync(join(configDir, file), 'utf8')); }
    catch { return null; }
  };

  errors.push(...validateModels(parse('models.json')));
  errors.push(...validateEntityConfig(parse('entity_maps.json')?.entity_maps));
  errors.push(...validateExecution(parse('execution.json')?.execution));
  errors.push(...validatePersonas(parse('personas.json')));

  if (requireKeys && !hasValidApiKey(env)) {
    errors.push('No valid API key found in environment. Set at least one of ' +
      'OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, PERPLEXITY_API_KEY, DEEPSEEK_API_KEY in .env');
  }

  if (errors.length > 0) {
    throw new ConfigError('Configuration validation failed', errors);
  }
  return { ok: true, configDir };
}

export function loadValidatedConfig() {
  validateAllConfigs();
  const configDir = join(ROOT_DIR, 'config');
  return {
    execution: JSON.parse(readFileSync(join(configDir, 'execution.json'), 'utf8')).execution,
    models: JSON.parse(readFileSync(join(configDir, 'models.json'), 'utf8')),
    personas: JSON.parse(readFileSync(join(configDir, 'personas.json'), 'utf8')),
    entityMaps: JSON.parse(readFileSync(join(configDir, 'entity_maps.json'), 'utf8')),
    analytics: JSON.parse(readFileSync(join(configDir, 'analytics.json'), 'utf8'))
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = validateAllConfigs({ requireKeys: true });
    console.log('Configuration OK');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    for (const e of err.errors || []) console.error(`  - ${e}`);
    process.exit(1);
  }
}
