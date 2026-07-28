import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import PQueue from 'p-queue';

import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GoogleProvider } from './providers/google.js';
import { PerplexityProvider } from './providers/perplexity.js';
import { DeepSeekProvider } from './providers/deepseek.js';
import { PlaywrightScraper } from './scrapers/playwrightScraper.js';
import { PromptGenerator } from './utils/promptGenerator.js';
import { ResponseExtractor } from './utils/responseExtractor.js';
import { CostTracker } from './utils/costTracker.js';
import { RateLimiter } from './utils/rateLimiter.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'aeo-orchestrator' },
  transports: [
    new winston.transports.File({ filename: join(ROOT_DIR, 'logs', 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: join(ROOT_DIR, 'logs', 'combined.log') }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      )
    })
  ]
});

class AEOOrchestrator {
  constructor(config = {}) {
    this.config = this.loadConfig(config);
    this.providers = {};
    this.playwrightScraper = null;
    this.promptGenerator = new PromptGenerator(this.config);
    this.responseExtractor = new ResponseExtractor();
    this.costTracker = new CostTracker(this.config);
    this.rateLimiters = {};
    this.apiQueue = new PQueue({ concurrency: this.config.execution.max_concurrent_api });
    this.playwrightQueue = new PQueue({ concurrency: this.config.execution.max_concurrent_playwright });
    this.results = [];
    this.sessionId = uuidv4();
    this.startTime = null;
    this.runDir = join(ROOT_DIR, 'data', 'output', `run_${this.sessionId}`);

    this.ensureDirectories();
  }

  loadConfig(overrides = {}) {
    const configPath = join(ROOT_DIR, 'config');
    const baseConfig = {
      execution: JSON.parse(readFileSync(join(configPath, 'execution.json'), 'utf8')).execution,
      models: JSON.parse(readFileSync(join(configPath, 'models.json'), 'utf8')),
      personas: JSON.parse(readFileSync(join(configPath, 'personas.json'), 'utf8')),
      entityMaps: JSON.parse(readFileSync(join(configPath, 'entity_maps.json'), 'utf8')),
      analytics: JSON.parse(readFileSync(join(configPath, 'analytics.json'), 'utf8'))
    };

    return this.deepMerge(baseConfig, overrides);
  }

  deepMerge(target, source) {
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        output[key] = this.deepMerge(output[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  }

  ensureDirectories() {
    const dirs = [
      join(ROOT_DIR, 'logs'),
      this.runDir,
      join(this.runDir, 'raw_responses'),
      join(this.runDir, 'extracted_data'),
      join(this.runDir, 'sessions'),
      join(ROOT_DIR, 'data', 'sessions')
    ];
    dirs.forEach(dir => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    });
  }

  async initialize() {
    logger.info('Initializing AEO Orchestrator', { sessionId: this.sessionId });

    const apiKeyMap = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      google: process.env.GOOGLE_AI_API_KEY,
      perplexity: process.env.PERPLEXITY_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY
    };

    if (apiKeyMap.openai) {
      this.providers.openai = new OpenAIProvider(apiKeyMap.openai, this.config);
      this.rateLimiters.openai = new RateLimiter(this.config.execution.rate_limiting.openai);
      logger.info('OpenAI provider initialized');
    }

    if (apiKeyMap.anthropic) {
      this.providers.anthropic = new AnthropicProvider(apiKeyMap.anthropic, this.config);
      this.rateLimiters.anthropic = new RateLimiter(this.config.execution.rate_limiting.anthropic);
      logger.info('Anthropic provider initialized');
    }

    if (apiKeyMap.google) {
      this.providers.google = new GoogleProvider(apiKeyMap.google, this.config);
      this.rateLimiters.google = new RateLimiter(this.config.execution.rate_limiting.google);
      logger.info('Google provider initialized');
    }

    if (apiKeyMap.perplexity) {
      this.providers.perplexity = new PerplexityProvider(apiKeyMap.perplexity, this.config);
      this.rateLimiters.perplexity = new RateLimiter(this.config.execution.rate_limiting.perplexity);
      logger.info('Perplexity provider initialized');
    }

    if (apiKeyMap.deepseek) {
      this.providers.deepseek = new DeepSeekProvider(apiKeyMap.deepseek, this.config);
      this.rateLimiters.deepseek = new RateLimiter(this.config.execution.rate_limiting.deepseek);
      logger.info('DeepSeek provider initialized');
    }

    if (this.config.execution.mode !== 'api_only') {
      try {
        this.playwrightScraper = new PlaywrightScraper(this.config);
        await this.playwrightScraper.initialize();
        logger.info('Playwright scraper initialized');
      } catch (err) {
        logger.warn('Playwright initialization failed, falling back to API only', { error: err.message });
        this.config.execution.mode = 'api_only';
      }
    }

    const providerCount = Object.keys(this.providers).length + (this.playwrightScraper ? 1 : 0);
    logger.info(`Initialization complete. ${providerCount} providers available.`);
    return this;
  }

  async run(options = {}) {
    this.startTime = Date.now();
    logger.info('Starting AEO simulation run', { sessionId: this.sessionId });

    const prompts = await this.promptGenerator.generateAllPrompts(
      options.promptCount || 5000,
      options.personas || undefined
    );
    logger.info(`Generated ${prompts.length} multi-turn prompt sessions`);

    const executionPlan = this.buildExecutionPlan(prompts);
    logger.info(`Execution plan: ${executionPlan.length} total API calls across ${Object.keys(this.providers).length} providers`);

    const results = await this.executePlan(executionPlan);

    await this.saveResults(results);

    const summary = this.generateRunSummary(results);
    logger.info('Run complete', summary);

    return { sessionId: this.sessionId, results, summary, runDir: this.runDir };
  }

  buildExecutionPlan(prompts) {
    const plan = [];
    const mode = this.config.execution.mode;
    const playwrightSampleRate = this.config.execution.playwright_sample_rate;

    for (const promptSession of prompts) {
      const shouldUsePlaywright = mode !== 'api_only' && Math.random() < playwrightSampleRate;
      const models = this.selectModelsForPrompt(promptSession);

      for (const turn of promptSession.turns) {
        for (const modelId of models) {
          const provider = this.getProviderForModel(modelId);
          if (!provider) continue;

          plan.push({
            executionId: uuidv4(),
            promptSession: promptSession,
            turn: turn,
            modelId: modelId,
            provider: provider,
            usePlaywright: shouldUsePlaywright && this.playwrightScraper,
            ragEnabled: true,
            priority: turn.turnIndex === 0 ? 'high' : 'normal'
          });

          if (this.config.attribution_split?.enabled && turn.turnIndex === 0) {
            plan.push({
              executionId: uuidv4(),
              promptSession: promptSession,
              turn: turn,
              modelId: modelId,
              provider: provider,
              usePlaywright: false,
              ragEnabled: false,
              priority: 'normal'
            });
          }
        }
      }
    }

    return plan;
  }

  selectModelsForPrompt(promptSession) {
    const allModelIds = [];
    const modelsConfig = this.config.models.models;

    for (const [providerName, providerModels] of Object.entries(modelsConfig)) {
      for (const [modelId, modelConfig] of Object.entries(providerModels)) {
        if (this.providers[providerName]) {
          allModelIds.push(modelId);
        }
      }
    }

    if (this.config.execution.playwright_sample_rate < 1) {
      return allModelIds.filter(() => Math.random() >= this.config.execution.playwright_sample_rate * 0.5);
    }

    return allModelIds;
  }

  getProviderForModel(modelId) {
    const modelsConfig = this.config.models.models;
    for (const [providerName, providerModels] of Object.entries(modelsConfig)) {
      if (providerModels[modelId] && this.providers[providerName]) {
        return { name: providerName, modelConfig: providerModels[modelId], instance: this.providers[providerName] };
      }
    }
    return null;
  }

  async executePlan(plan) {
    const results = [];
    const batchedPlan = this.batchByPriority(plan);

    for (const batch of batchedPlan) {
      if (batch.priority === 'high') {
        const batchResults = await Promise.allSettled(
          batch.tasks.map(task => this.executeTask(task))
        );
        results.push(...batchResults.map((r, i) => ({
          ...batch.tasks[i],
          result: r.status === 'fulfilled' ? r.value : null,
          error: r.status === 'rejected' ? r.reason?.message : null,
          status: r.status
        })));
      } else {
        const batchResults = await Promise.allSettled(
          batch.tasks.map(task => this.executeTask(task))
        );
        results.push(...batchResults.map((r, i) => ({
          ...batch.tasks[i],
          result: r.status === 'fulfilled' ? r.value : null,
          error: r.status === 'rejected' ? r.reason?.message : null,
          status: r.status
        })));
      }
    }

    return results;
  }

  batchByPriority(plan) {
    const batches = [];
    const highPriority = plan.filter(t => t.priority === 'high');
    const normalPriority = plan.filter(t => t.priority !== 'high');

    if (highPriority.length > 0) {
      batches.push({ priority: 'high', tasks: highPriority });
    }

    const batchSize = this.config.execution.max_concurrent_api * 2;
    for (let i = 0; i < normalPriority.length; i += batchSize) {
      batches.push({ priority: 'normal', tasks: normalPriority.slice(i, i + batchSize) });
    }

    return batches;
  }

  async executeTask(task) {
    const { executionId, turn, modelId, provider, usePlaywright, ragEnabled, promptSession } = task;

    logger.debug('Executing task', { executionId, modelId, turnIndex: turn.turnIndex, ragEnabled });

    const messages = this.buildMessages(promptSession, turn, ragEnabled);
    const modelConfig = provider.modelConfig;
    const temperature = this.config.execution.temperature || 0.15;

    let response;

    if (usePlaywright && this.playwrightScraper) {
      response = await this.playwrightQueue.add(async () => {
        const browserTarget = this.selectPlaywrightTarget(modelId);
        return await this.playwrightScraper.queryWithRetry(modelId, messages, browserTarget);
      });
    } else {
      response = await this.apiQueue.add(async () => {
        await this.rateLimiters[provider.name]?.waitForSlot();
        return await this.retryWithBackoff(async () => {
          return await provider.instance.chat(messages, {
            model: modelConfig.model_id,
            temperature,
            max_tokens: this.config.execution.max_tokens || modelConfig.max_tokens,
            top_p: this.config.execution.top_p || 0.9,
            seed: modelConfig.supports_seed ? 42 : undefined,
            search_enabled: ragEnabled && modelConfig.supports_web_search,
            stream: false
          });
        });
      });
    }

    const extracted = this.responseExtractor.extract(response, {
      modelId,
      turnIndex: turn.turnIndex,
      executionId,
      ragEnabled,
      promptSession
    });

    this.costTracker.track(modelConfig, response);

    return extracted;
  }

  buildMessages(promptSession, turn, ragEnabled) {
    const messages = [];
    const persona = this.config.personas.personas.find(p => p.persona_id === promptSession.personaId);

    if (persona && ragEnabled) {
      messages.push({ role: 'system', content: persona.system_instruction_bias });
    }

    for (let i = 0; i < turn.turnIndex; i++) {
      messages.push({ role: 'user', content: promptSession.turns[i].prompt });
      if (i < turn.turnIndex && promptSession.turns[i].context?.responsePreview) {
        messages.push({ role: 'assistant', content: promptSession.turns[i].context.responsePreview });
      }
    }

    messages.push({ role: 'user', content: turn.prompt });

    return messages;
  }

  selectPlaywrightTarget(modelId) {
    if (modelId.includes('gpt')) return 'chatgpt_web';
    if (modelId.includes('claude')) return 'claude_web';
    if (modelId.includes('sonar') || modelId.includes('perplexity')) return 'perplexity_web';
    return null;
  }

  async retryWithBackoff(fn) {
    const retryConfig = this.config.execution.retry;
    let lastError;

    for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < retryConfig.attempts) {
          const delay = Math.min(
            retryConfig.delay_ms * Math.pow(retryConfig.backoff_multiplier, attempt - 1),
            retryConfig.max_delay_ms
          );
          logger.warn(`Retry ${attempt}/${retryConfig.attempts} after ${delay}ms`, { error: error.message });
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }

  async saveResults(results) {
    const outputPath = join(this.runDir, 'extracted_data', 'all_results.json');
    const processedResults = results.map(r => ({
      executionId: r.executionId,
      promptSessionId: r.promptSession?.sessionId,
      personaId: r.promptSession?.personaId,
      modelId: r.modelId,
      turnIndex: r.turn?.turnIndex,
      turnType: r.turn?.turnType,
      prompt: r.turn?.prompt,
      ragEnabled: r.ragEnabled,
      result: r.result,
      error: r.error,
      status: r.status,
      timestamp: new Date().toISOString()
    }));

    writeFileSync(outputPath, JSON.stringify(processedResults, null, 2));
    logger.info(`Results saved to ${outputPath}`, { totalResults: results.length });

    const costReport = this.costTracker.getReport();
    const costPath = join(this.runDir, 'extracted_data', 'cost_report.json');
    writeFileSync(costPath, JSON.stringify(costReport, null, 2));

    const metadataPath = join(this.runDir, 'run_metadata.json');
    writeFileSync(metadataPath, JSON.stringify({
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: Date.now(),
      duration: Date.now() - this.startTime,
      totalTasks: results.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      costReport
    }, null, 2));
  }

  generateRunSummary(results) {
    const successful = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');
    const costReport = this.costTracker.getReport();

    return {
      sessionId: this.sessionId,
      duration: Date.now() - this.startTime,
      totalTasks: results.length,
      successful: successful.length,
      failed: failed.length,
      successRate: `${((successful.length / results.length) * 100).toFixed(1)}%`,
      totalCost: costReport.totalCost,
      costPerQuery: costReport.totalCost / (successful.length || 1),
      modelsUsed: [...new Set(results.map(r => r.modelId))],
      personasUsed: [...new Set(results.map(r => r.promptSession?.personaId))],
      runDirectory: this.runDir
    };
  }

  async cleanup() {
    if (this.playwrightScraper) {
      await this.playwrightScraper.cleanup();
    }
    logger.info('Orchestrator cleanup complete');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : 'orchestrate';

  const promptCountIndex = args.indexOf('--prompts');
  const promptCount = promptCountIndex !== -1 ? parseInt(args[promptCountIndex + 1]) : 5000;

  const modelsIndex = args.indexOf('--models');
  const models = modelsIndex !== -1 ? args[modelsIndex + 1]?.split(',') : undefined;

  const orchestrator = new AEOOrchestrator();

  try {
    await orchestrator.initialize();
    const result = await orchestrator.run({ promptCount });
    console.log('\n=== AEO Simulation Run Complete ===');
    console.log(JSON.stringify(result.summary, null, 2));
  } catch (error) {
    logger.error('Fatal error in orchestrator', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await orchestrator.cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { AEOOrchestrator };
