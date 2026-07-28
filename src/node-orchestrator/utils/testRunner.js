/**
 * AEO Citation Graph Simulator - Node.js Test Runner
 * Validates provider initialization and basic functionality
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ResponseExtractor } from './utils/responseExtractor.js';
import { PromptGenerator } from './utils/promptGenerator.js';
import { CostTracker } from './utils/costTracker.js';
import { RateLimiter } from './utils/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

function testResponseExtractor() {
  log('🔍', 'Testing ResponseExtractor...');

  const extractor = new ResponseExtractor();
  const mockResponse = {
    raw_text: 'Brand_A provides excellent SOC2 compliance. Brand_B lacks audit logging. See https://gartner.com/reviews and https://reddit.com/r/netsec for details.',
    citations: [
      { url: 'https://gartner.com/reviews', title: 'Gartner Reviews' },
      { url: 'https://reddit.com/r/netsec', title: 'Reddit Security' }
    ],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    search_performed: true,
    finish_reason: 'stop'
  };

  const context = {
    executionId: 'test-001',
    modelId: 'gpt-4o',
    turnIndex: 0,
    ragEnabled: true,
    turn: { turnType: 'category_discovery' },
    promptSession: { sessionId: 'session-001', personaId: 'ciso' }
  };

  const result = extractor.extract(mockResponse, context);

  const tests = [
    ['Has raw text', result.raw_text.length > 0],
    ['Has citations', result.citations.length >= 2],
    ['Has entities', result.entities.length > 0],
    ['Has sentiment', result.sentiment && typeof result.sentiment === 'object'],
    ['Has triples', Array.isArray(result.triples)],
    ['Success flag', result.success === true],
    ['Execution ID matches', result.executionId === 'test-001']
  ];

  let passed = 0;
  for (const [name, test] of tests) {
    if (test) {
      log('  ✅', name);
      passed++;
    } else {
      log('  ❌', name);
    }
  }

  return passed === tests.length;
}

function testPromptGenerator() {
  log('🔍', 'Testing PromptGenerator...');

  const config = {
    execution: { multi_turn: { min_turns: 3, max_turns: 5, turn_types: ['category_discovery', 'feature_deep_dive', 'comparison_analysis'] } },
    personas: { personas: [
      { persona_id: 'test_persona', display_name: 'Test', turn_templates: { category_discovery: 'What are the best {category} tools?', feature_deep_dive: 'How does {brand_a} compare?' }, prompt_parameters: { category: ['security'] } }
    ]},
    entity_maps: { entity_maps: { your_brand: { primary_name: 'Brand_A' }, competitors: [{ primary_name: 'Brand_B' }] } }
  };

  const generator = new PromptGenerator(config);
  const prompts = generator.generateAllPrompts(5);

  const tests = [
    ['Generates correct count', prompts.length === 5],
    ['Has session IDs', prompts.every(p => p.sessionId)],
    ['Has persona ID', prompts.every(p => p.personaId === 'test_persona')],
    ['Has turns array', prompts.every(p => Array.isArray(p.turns) && p.turns.length >= 3)],
    ['Turns have prompts', prompts.every(p => p.turns.every(t => t.prompt && t.prompt.length > 0))]
  ];

  let passed = 0;
  for (const [name, test] of tests) {
    if (test) {
      log('  ✅', name);
      passed++;
    } else {
      log('  ❌', name);
    }
  }

  return passed === tests.length;
}

function testCostTracker() {
  log('🔍', 'Testing CostTracker...');

  const config = { execution: { cost_tracking: { enabled: true, daily_budget_usd: 100, alert_threshold_pct: 80 } } };
  const tracker = new CostTracker(config);

  const mockModelConfig = { model_id: 'gpt-4o', provider: 'openai', cost_per_1k_input: 0.005, cost_per_1k_output: 0.015 };
  const mockResponse = { usage: { prompt_tokens: 1000, completion_tokens: 500 } };

  tracker.track(mockModelConfig, mockResponse);
  const report = tracker.getReport();

  const tests = [
    ['Tracks cost', report.totalCost > 0],
    ['Has model breakdown', 'gpt-4o' in report.costByModel],
    ['Has provider breakdown', 'openai' in report.costByProvider],
    ['Calculates budget remaining', report.budgetRemaining < 100],
    ['Has request count', report.totalRequests === 1]
  ];

  let passed = 0;
  for (const [name, test] of tests) {
    if (test) {
      log('  ✅', name);
      passed++;
    } else {
      log('  ❌', name);
    }
  }

  return passed === tests.length;
}

function testRateLimiter() {
  log('🔍', 'Testing RateLimiter...');

  const limiter = new RateLimiter({ rpm: 100, tpm: 100000 });
  const stats = limiter.getStats();

  const tests = [
    ['Has RPM limit', stats.rpm_limit === 100],
    ['Has TPM limit', stats.tpm_limit === 100000],
    ['Queue starts empty', stats.queue_length === 0]
  ];

  let passed = 0;
  for (const [name, test] of tests) {
    if (test) {
      log('  ✅', name);
      passed++;
    } else {
      log('  ❌', name);
    }
  }

  return passed === tests.length;
}

function testConfigLoading() {
  log('🔍', 'Testing config loading...');

  const configDir = join(ROOT_DIR, 'config');
  const files = ['models.json', 'execution.json', 'analytics.json', 'personas.json', 'entity_maps.json'];

  let passed = 0;
  for (const file of files) {
    const path = join(configDir, file);
    if (existsSync(path)) {
      try {
        JSON.parse(readFileSync(path, 'utf8'));
        log('  ✅', `${file} loads correctly`);
        passed++;
      } catch (e) {
        log('  ❌', `${file} parse error: ${e.message}`);
      }
    } else {
      log('  ❌', `${file} not found`);
    }
  }

  return passed === files.length;
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  AEO Citation Graph Simulator - Node.js Test Suite');
  console.log('='.repeat(60) + '\n');

  const results = {};
  results.config = testConfigLoading();
  results.responseExtractor = testResponseExtractor();
  results.promptGenerator = testPromptGenerator();
  results.costTracker = testCostTracker();
  results.rateLimiter = testRateLimiter();

  console.log('\n' + '='.repeat(60));
  console.log('  TEST RESULTS');
  console.log('='.repeat(60));

  let allPassed = true;
  for (const [test, passed] of Object.entries(results)) {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}  ${test}`);
    if (!passed) allPassed = false;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`  Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('='.repeat(60) + '\n');

  process.exit(allPassed ? 0 : 1);
}

main();
