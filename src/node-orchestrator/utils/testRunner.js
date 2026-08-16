/**
 * AEO Citation Graph Simulator - Real Configuration Validator
 * Validates that the environment is properly configured for real data collection.
 * Does NOT use any mock/synthetic data.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..', '..');

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

function validateEnvFile() {
  log('🔍', 'Checking .env file...');
  const envPath = join(ROOT_DIR, '.env');
  if (!existsSync(envPath)) {
    log('❌', 'No .env file found. Copy .env.example to .env and add your API keys.');
    return false;
  }

  const envContent = readFileSync(envPath, 'utf8');
  const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'PERPLEXITY_API_KEY', 'DEEPSEEK_API_KEY'];
  const placeholderPatterns = ['sk-your-', 'sk-ant-your-', 'your-', 'pplx-your-'];

  let foundKey = null;
  for (const key of keys) {
    const line = envContent.split('\n').find(l => l.startsWith(key + '='));
    if (line) {
      const value = line.split('=').slice(1).join('=').trim();
      if (value && !placeholderPatterns.some(p => value.startsWith(p))) {
        foundKey = key;
        log('✅', `Found valid ${key}`);
        break;
      }
    }
  }

  if (!foundKey) {
    log('❌', 'No valid API keys found in .env. All keys are still placeholders.');
    return false;
  }

  return true;
}

function validateEntityConfig() {
  log('🔍', 'Checking entity configuration...');
  const configPath = join(ROOT_DIR, 'config', 'entity_maps.json');

  if (!existsSync(configPath)) {
    log('❌', 'config/entity_maps.json not found');
    return false;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const entityMaps = config.entity_maps;

    if (!entityMaps || !entityMaps.your_brand || !entityMaps.your_brand.primary_name) {
      log('❌', 'your_brand.primary_name is empty. You MUST configure your brand name.');
      return false;
    }
    log('✅', `Primary brand: ${entityMaps.your_brand.primary_name}`);

    if (!entityMaps.competitors || entityMaps.competitors.length === 0) {
      log('❌', 'No competitors configured. Add at least one competitor.');
      return false;
    }
    log('✅', `Competitors: ${entityMaps.competitors.map(c => c.primary_name).join(', ')}`);

    if (!entityMaps.your_brand.website) {
      log('⚠️', 'No website configured for your brand (recommended)');
    }

    if (!entityMaps.external_authority_sources || entityMaps.external_authority_sources.length === 0) {
      log('⚠️', 'No external authority sources configured (recommended for citation analysis)');
    }

    return true;
  } catch (e) {
    log('❌', `Failed to parse entity_maps.json: ${e.message}`);
    return false;
  }
}

function validatePersonasConfig() {
  log('🔍', 'Checking persona configuration...');
  const configPath = join(ROOT_DIR, 'config', 'personas.json');

  if (!existsSync(configPath)) {
    log('❌', 'config/personas.json not found');
    return false;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!config.personas || config.personas.length === 0) {
      log('❌', 'No personas configured');
      return false;
    }

    for (const persona of config.personas) {
      if (!persona.persona_id || !persona.turn_templates) {
        log('❌', `Persona ${persona.persona_id || '(unknown)'} missing required fields`);
        return false;
      }
      const templates = Object.values(persona.turn_templates);
      const unresolved = templates.filter(t => t.includes('{') && !t.includes('your_brand') && !t.includes('brand_a'));
      if (unresolved.length > 0) {
        log('⚠️', `Persona ${persona.persona_id} has templates that may need brand placeholders`);
      }
    }

    log('✅', `${config.personas.length} personas configured`);
    return true;
  } catch (e) {
    log('❌', `Failed to parse personas.json: ${e.message}`);
    return false;
  }
}

function validateConfigFiles() {
  log('🔍', 'Checking all config files...');
  const configDir = join(ROOT_DIR, 'config');
  const files = ['models.json', 'execution.json', 'analytics.json', 'personas.json', 'entity_maps.json'];

  let allValid = true;
  for (const file of files) {
    const path = join(configDir, file);
    if (!existsSync(path)) {
      log('❌', `${file} not found`);
      allValid = false;
      continue;
    }
    try {
      JSON.parse(readFileSync(path, 'utf8'));
      log('✅', `${file} is valid JSON`);
    } catch (e) {
      log('❌', `${file} has invalid JSON: ${e.message}`);
      allValid = false;
    }
  }
  return allValid;
}

function checkNoSyntheticFiles() {
  log('🔍', 'Checking for synthetic data files that should have been removed...');
  const syntheticPaths = [
    join(ROOT_DIR, 'src', 'python-engine', 'generate_sample_data.py'),
    join(ROOT_DIR, 'src', 'python-engine', 'produce_sample_data.py'),
    join(ROOT_DIR, 'src', 'python-engine', 'produce_sample_inputs.py'),
    join(ROOT_DIR, 'data', 'samples'),
    join(ROOT_DIR, 'data', 'output', 'run_demo_001'),
  ];

  let allClean = true;
  for (const p of syntheticPaths) {
    if (existsSync(p)) {
      log('❌', `Synthetic artifact still exists: ${p}`);
      allClean = false;
    }
  }
  if (allClean) {
    log('✅', 'No synthetic data artifacts found');
  }
  return allClean;
}

function validatePersonaPlaceholders() {
  log('🔍', 'Checking persona template placeholders are resolvable...');
  const personasPath = join(ROOT_DIR, 'config', 'personas.json');
  const entityPath = join(ROOT_DIR, 'config', 'entity_maps.json');
  if (!existsSync(personasPath) || !existsSync(entityPath)) return true;
  try {
    const personas = JSON.parse(readFileSync(personasPath, 'utf8')).personas || [];
    const entityMaps = JSON.parse(readFileSync(entityPath, 'utf8')).entity_maps || {};
    const primaryBrand = entityMaps.your_brand?.primary_name || '';
    const competitors = entityMaps.competitors || [];
    const brandParams = {
      your_brand: primaryBrand, brand_a: primaryBrand,
      competitor_1: competitors[0]?.primary_name || '',
      brand_b: competitors[0]?.primary_name || '',
      competitor_2: competitors[1]?.primary_name || '',
      brand_c: competitors[1]?.primary_name || '',
      competitor_3: competitors[2]?.primary_name || ''
    };
    const defaults = {
      vertical: 'enterprise software', category: 'enterprise software',
      company_size: '500-1000 employees', use_case: 'enterprise deployment',
      feature: 'core functionality', metric: 'performance benchmarks',
      volume: '1M requests/day', deployment_type: 'cloud',
      compliance_requirement: 'SOC2'
    };
    let allResolvable = true;
    for (const persona of personas) {
      const params = persona.prompt_parameters || {};
      const templates = Object.entries(persona.turn_templates || {});
      for (const [type, template] of templates) {
        const placeholders = [...new Set((String(template).match(/\{([^}]+)\}/g) || []).map(p => p.slice(1, -1)))];
        for (const key of placeholders) {
          const paramValue = params[key];
          const paramResolvable = paramValue !== undefined && paramValue !== '' &&
            (!Array.isArray(paramValue) || paramValue.length > 0);
          const resolvable = paramResolvable || Boolean(brandParams[key]) || Boolean(defaults[key]);
          if (!resolvable) {
            log('❌', `Persona "${persona.persona_id}" template "${type}" uses {${key}} which cannot be resolved. Add "${key}" to prompt_parameters in config/personas.json or define it in config/entity_maps.json.`);
            allResolvable = false;
          }
        }
      }
    }
    if (allResolvable) log('✅', 'All persona placeholders resolvable');
    return allResolvable;
  } catch (e) {
    log('⚠️', `Could not fully validate placeholders: ${e.message}`);
    return true;
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  AEO Citation Graph Simulator - Real Configuration Validator');
  console.log('='.repeat(60) + '\n');

  const results = {};
  results.envFile = validateEnvFile();
  results.entityConfig = validateEntityConfig();
  results.personasConfig = validatePersonasConfig();
  results.personaPlaceholders = validatePersonaPlaceholders();
  results.configFiles = validateConfigFiles();
  results.noSynthetic = checkNoSyntheticFiles();

  console.log('\n' + '='.repeat(60));
  console.log('  VALIDATION RESULTS');
  console.log('='.repeat(60));

  let allPassed = true;
  for (const [test, passed] of Object.entries(results)) {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}  ${test}`);
    if (!passed) allPassed = false;
  }

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('  ✅ ALL CHECKS PASSED - Ready for real data collection');
  } else {
    console.log('  ❌ SOME CHECKS FAILED - Fix the issues above before running');
  }
  console.log('='.repeat(60) + '\n');

  process.exit(allPassed ? 0 : 1);
}

main();
