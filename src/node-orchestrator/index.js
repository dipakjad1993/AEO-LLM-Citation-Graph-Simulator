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
import { GrokProvider } from './providers/grok.js';
import { SerpProvider, CopilotProvider, AIOverviewsProvider, AIModeProvider } from './providers/serp.js';
import { PlaywrightScraper } from './scrapers/playwrightScraper.js';
import { PromptGenerator } from './utils/promptGenerator.js';
import { ResponseExtractor } from './utils/responseExtractor.js';
import { CostTracker, BudgetExceededError } from './utils/costTracker.js';
import { RateLimiter } from './utils/rateLimiter.js';
import { ResponseVerifier } from './utils/responseVerifier.js';
import { validateAllConfigs, ConfigError } from '../../config/validator.js';
import {
  buildResultProvenance,
  buildRunManifest,
  writeManifest,
  appendAuditEntry,
  persistRawResponse,
  randomRunId
} from './utils/provenance.js';

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
    this.responseVerifier = new ResponseVerifier(this.config, {
      online: this.config.execution?.verification?.citation_http_check !== false,
      concurrency: this.config.execution?.verification?.citation_concurrency || 8
    });
    this.rateLimiters = {};
    this.apiQueue = new PQueue({ concurrency: this.config.execution.max_concurrent_api });
    this.playwrightQueue = new PQueue({ concurrency: this.config.execution.max_concurrent_playwright });
    this.results = [];
    this.sessionId = uuidv4();
    this.runId = randomRunId();
    this.startTime = null;
    this.runDir = join(ROOT_DIR, 'data', 'output', `run_${Date.now()}_${this.runId}`);

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

    // Allow environment overrides for execution parameters.
    const envOverrides = {};
    if (process.env.TEMPERATURE) envOverrides.temperature = parseFloat(process.env.TEMPERATURE);
    if (process.env.TOP_P) envOverrides.top_p = parseFloat(process.env.TOP_P);
    if (process.env.MAX_TOKENS) envOverrides.max_tokens = parseInt(process.env.MAX_TOKENS, 10);
    if (process.env.MAX_CONCURRENT_REQUESTS) envOverrides.max_concurrent_api = parseInt(process.env.MAX_CONCURRENT_REQUESTS, 10);
    if (Object.keys(envOverrides).length) {
      baseConfig.execution = { ...baseConfig.execution, ...envOverrides };
    }

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
    logger.info('Initializing AEO Orchestrator', { sessionId: this.sessionId, runId: this.runId });

    try {
      validateAllConfigs({ env: process.env, requireKeys: true });
    } catch (err) {
      if (err instanceof ConfigError) {
        const detail = err.errors.join('; ');
        logger.error('Configuration validation failed', { errors: err.errors });
        throw new Error(`FATAL: ${detail}`);
      }
      throw err;
    }

    const entityConfig = this.config.entityMaps;
    const yourBrand = entityConfig?.entity_maps?.your_brand;
    if (process.env.AEO_DEMO_MODE === '1') {
      // Keyless demo: seed a synthetic brand + competitors so validation passes.
      const em = this.config.entityMaps.entity_maps;
      if (!em.your_brand?.primary_name) {
        em.your_brand = {
          primary_name: 'Acme Analytics', display_name: 'Acme Analytics',
          aliases: ['Acme'], website: 'https://example.com', category: 'analytics platform',
          attributes: { features: ['dashboards', 'alerts'], pricing_model: 'SaaS', target_segment: ['enterprise'], certifications: ['SOC2'], unique_selling_points: ['real-time insights'] },
          ground_truth_urls: [], monitoring_keywords: ['analytics platform']
        };
      }
      if (!em.competitors?.length) {
        em.competitors = [{ primary_name: 'RivalOne', display_name: 'RivalOne' }, { primary_name: 'RivalTwo', display_name: 'RivalTwo' }];
      }
      // Demo registry: single synthetic model so coverage is fast and free.
      this.config.models = { models: { demo: { 'demo-model': { model_id: 'demo-model', display_name: 'Demo (synthetic)', provider: 'demo', supports_web_search: true, supports_seed: false, max_tokens: 4000, cost_per_1k_input: 0, cost_per_1k_output: 0, temperature_range: [0, 1], supports_system_message: true } } } };
      logger.info('Demo mode: seeded synthetic brand/competitors + demo model registry');
    }
    const brandCheck = this.config.entityMaps?.entity_maps?.your_brand;
    if (!brandCheck || !brandCheck.primary_name) {
      throw new Error('FATAL: No primary brand configured. Fill in config/entity_maps.json with your_brand.primary_name before running.');
    }
    if (!this.config.entityMaps?.entity_maps?.competitors || this.config.entityMaps.entity_maps.competitors.length === 0) {
      throw new Error('FATAL: No competitors configured. Add at least one competitor to config/entity_maps.json.');
    }

    const apiKeyMap = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      google: process.env.GOOGLE_AI_API_KEY,
      perplexity: process.env.PERPLEXITY_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY,
      xai: process.env.XAI_API_KEY,
      serp: process.env.SERP_API_KEY
    };

    const hasAnyKey = Object.values(apiKeyMap).some(k => k && !k.startsWith('your-') && !k.startsWith('sk-your-') && !k.startsWith('sk-ant-your-') && !k.startsWith('pplx-your-'));
    if (!hasAnyKey && !process.env.AEO_DEMO_MODE) {
      throw new Error('FATAL: No valid API keys found. Set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, PERPLEXITY_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY, SERP_API_KEY in your .env file. Or run with AEO_DEMO_MODE=1 for a keyless demo.');
    }

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

    if (apiKeyMap.xai) {
      this.providers.xai = new GrokProvider(apiKeyMap.xai, this.config);
      this.rateLimiters.xai = new RateLimiter(this.config.execution.rate_limiting.xai || { rpm: 200, tpm: 200000 });
      logger.info('Grok (xAI) provider initialized');
    }

    if (apiKeyMap.serp) {
      this.providers.microsoft = new CopilotProvider(apiKeyMap.serp, this.config);
      this.providers['google-serp'] = new AIOverviewsProvider(apiKeyMap.serp, this.config);
      this.rateLimiters.microsoft = new RateLimiter({ rpm: 60, tpm: 32000 });
      this.rateLimiters['google-serp'] = new RateLimiter({ rpm: 60, tpm: 32000 });
      logger.info('SERP providers initialized (Copilot + AI Overviews/AI Mode)');
    }

    // Demo mode: keyless synthetic provider so `npm start -- --demo` works with zero keys.
    if (process.env.AEO_DEMO_MODE === '1' && Object.keys(this.providers).length === 0) {
      const { DemoProvider } = await import('./providers/demo.js');
      this.providers.demo = new DemoProvider(null, this.config);
      this.rateLimiters.demo = new RateLimiter({ rpm: 1000, tpm: 100000 });
      logger.info('Demo provider initialized (synthetic, keyless)');
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
    this.modelFilter = Array.isArray(options.models) ? new Set(options.models) : null;

    const prompts = await this.promptGenerator.generateAllPrompts(
      options.promptCount || this.config.execution.prompt_count || 50,
      options.personas || undefined
    );
    logger.info(`Generated ${prompts.length} multi-turn prompt sessions`);

    const executionPlan = this.buildExecutionPlan(prompts);
    logger.info(`Execution plan: ${executionPlan.length} total API calls across ${Object.keys(this.providers).length} providers`);

    const results = await this.executePlan(executionPlan);

    // Verification layer: quality gates + citation HTTP verification.
    logger.info('Running response verification (quality gates + citation checks)');
    await this.responseVerifier.run(results);
    const verificationSummary = this.responseVerifier.summary();
    logger.info('Verification complete', verificationSummary);

    // Enforce quality gates: optionally demote failed-quality responses.
    if (this.config.execution?.verification?.reject_failed_quality) {
      for (const item of results) {
        const v = item.result?.verification;
        if (v && v.quality && !v.quality.passed && item.status === 'fulfilled') {
          item.status = 'rejected';
          item.error = `Quality gate failed: ${JSON.stringify(v.quality.checks)}`;
        }
      }
    }

    await this.saveResults(results, verificationSummary);

    const summary = this.generateRunSummary(results);
    logger.info('Run complete', summary);

    return { sessionId: this.sessionId, results, summary, runDir: this.runDir, verification: verificationSummary };
  }

  buildExecutionPlan(prompts) {
    const plan = [];
    const mode = this.config.execution.mode;
    const playwrightSampleRate = this.config.execution.playwright_sample_rate;
    // Volatility: repeat money prompts N times to measure answer variance (AIO shifts ~70% on repeat).
    const vol = this.config.execution?.volatility || {};
    const repeats = Math.max(1, Math.min(vol.repeats || 1, 10));

    for (const promptSession of prompts) {
      const shouldUsePlaywright = mode !== 'api_only' && this.playwrightScraper && Math.random() < playwrightSampleRate;
      // Full, deterministic coverage: every configured API model answers every prompt.
      const models = this.selectModelsForPrompt(promptSession);

      for (const turn of promptSession.turns) {
        const isMoneyPrompt = turn.turnType === 'comparison_analysis' || turn.turnType === 'pricing_procurement' || turn.turnIndex === 0;
        const n = (vol.enabled && isMoneyPrompt) ? repeats : 1;
        for (let rep = 0; rep < n; rep++) {
        for (const modelId of models) {
          const provider = this.getProviderForModel(modelId);
          if (!provider) continue;

          plan.push({
            executionId: uuidv4(),
            promptSession: promptSession,
            turn: turn,
            modelId: modelId,
            provider: provider,
            usePlaywright: shouldUsePlaywright,
            ragEnabled: true,
            volatilityRep: rep,
            priority: turn.turnIndex === 0 ? 'high' : 'normal'
          });

          if (this.config.execution?.attribution_split?.enabled && turn.turnIndex === 0) {
            plan.push({
              executionId: uuidv4(),
              promptSession: promptSession,
              turn: turn,
              modelId: modelId,
              provider: provider,
              usePlaywright: false,
              ragEnabled: false,
              volatilityRep: rep,
              priority: 'normal'
            });
          }
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
        if (this.providers[providerName] && (!this.modelFilter || this.modelFilter.has(modelId))) {
          allModelIds.push(modelId);
        }
      }
    }

    // NOTE: no random model dropping. Every configured provider/model is queried
    // for every prompt to guarantee complete, reproducible coverage. Randomly
    // dropping models corrupts coverage and produced incomplete datasets in the
    // past. Playwright browser sampling (prompt-level) is the only stochastic
    // element, and it does not drop real API models.
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
      const batchResults = await Promise.allSettled(
        batch.tasks.map(task => this.executeTask(task))
      );
      results.push(...batchResults.map((r, i) => ({
        ...batch.tasks[i],
        result: r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : null,
        status: r.status
      })));
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
        // Hard budget enforcement: stop making paid API calls once the cap is hit.
        this.costTracker.enforceBudget();

        await this.rateLimiters[provider.name]?.waitForSlot({ inputTokens: 0, outputTokens: 0 });
        const apiResponse = await this.retryWithBackoff(async () => {
          return await provider.instance.chat(messages, {
            model: modelConfig.model_id,
            temperature,
            max_tokens: this.config.execution.max_tokens || modelConfig.max_tokens,
            top_p: this.config.execution.top_p || 0.9,
            seed: modelConfig.supports_seed ? 42 : undefined,
            search_enabled: ragEnabled && modelConfig.supports_web_search,
            tool_choice: 'auto',
            allowed_domains: this.config.execution?.search_options?.allowed_domains || [],
            search_context_size: this.config.execution?.search_options?.search_context_size || 'medium',
            geo: this.config.execution?.geo?.default_country || undefined,
            stream: false
          });
        });

        // Track tokens for TPM enforcement.
        const usage = apiResponse.usage || {};
        const inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
        const outputTokens = usage.completion_tokens || usage.output_tokens || 0;
        this.rateLimiters[provider.name]?.trackTokens(inputTokens + outputTokens);
        return apiResponse;
      });
    }

    const extracted = this.responseExtractor.extract(response, {
      modelId,
      turnIndex: turn.turnIndex,
      executionId,
      ragEnabled,
      promptSession,
      entityConfig: this.config.entityMaps
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
    // Grok / Gemini / SERP surfaces have no Playwright target — API/SERP only.
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

  async saveResults(results, verificationSummary) {
    const outputPath = join(this.runDir, 'extracted_data', 'all_results.json');
    const processedResults = results.map(r => ({
      executionId: r.executionId,
      promptSessionId: r.promptSession?.sessionId,
      personaId: r.promptSession?.personaId,
      modelId: r.modelId,
      provider: r.provider?.name,
      turnIndex: r.turn?.turnIndex,
      turnType: r.turn?.turnType,
      prompt: r.turn?.prompt,
      ragEnabled: r.ragEnabled,
      volatilityRep: r.volatilityRep || 0,
      channel: r.usePlaywright ? 'web_ui' : 'api',
      hidden_search_queries: r.result?.hidden_search_queries || [],
      fanout_queries: r.result?.fanout_queries || [],
      search_performed: r.result?.search_performed || false,
      search_requested: r.result?.search_requested ?? r.ragEnabled,
      ungrounded: r.result?.ungrounded || false,
      grounding: r.result?.grounding || 'unknown',
      serp_surface: r.result?.serp_surface || null,
      result: r.result,
      error: r.error,
      status: r.status,
      timestamp: new Date().toISOString(),
      provenance: r.result?.raw_text ? buildResultProvenance({
        result: {
          raw_text: r.result.raw_text,
          modelId: r.modelId,
          provider: r.provider?.name,
          prompt: r.turn?.prompt,
          timestamp: new Date().toISOString(),
          verification: r.result.verification,
          citations: r.result.citations
        },
        config: this.config,
        sessionId: this.sessionId
      }) : null
    }));

    // Persist raw provider responses for audit.
    for (const r of results) {
      if (r.result?.raw_response) {
        try {
          persistRawResponse(this.runDir, {
            executionId: r.executionId,
            provider: r.provider?.name,
            raw: r.result.raw_response
          });
        } catch (err) {
          logger.warn('Failed to persist raw response', { executionId: r.executionId, error: err.message });
        }
      }
    }

    writeFileSync(outputPath, JSON.stringify(processedResults, null, 2));
    logger.info(`Results saved to ${outputPath}`, { totalResults: results.length });

    const costReport = this.costTracker.getReport();
    const costPath = join(this.runDir, 'extracted_data', 'cost_report.json');
    writeFileSync(costPath, JSON.stringify(costReport, null, 2));

    // Immutable run manifest with content hashes for tamper evidence.
    const endTime = Date.now();
    const manifest = buildRunManifest({
      runDir: this.runDir,
      config: this.config,
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime,
      results
    });
    const manifestPath = writeManifest(this.runDir, manifest);
    logger.info(`Run manifest written to ${manifestPath} (id: ${manifest.manifest_id})`);

    // Verification report.
    writeFileSync(join(this.runDir, 'extracted_data', 'verification_report.json'),
      JSON.stringify({
        summary: verificationSummary,
        per_response: this.responseVerifier.results
      }, null, 2));

    // Append-only audit trail entry.
    appendAuditEntry(join(ROOT_DIR, 'logs'), {
      event: 'run_completed',
      sessionId: this.sessionId,
      runId: this.runId,
      runDir: this.runDir,
      manifestId: manifest.manifest_id,
      configHash: manifest.config_hash,
      totalTasks: results.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      totalCost: costReport.totalCost,
      verification: verificationSummary
    });

    const metadataPath = join(this.runDir, 'run_metadata.json');
    writeFileSync(metadataPath, JSON.stringify({
      sessionId: this.sessionId,
      runId: this.runId,
      toolVersion: manifest.tool_version,
      startTime: this.startTime,
      endTime,
      duration: endTime - this.startTime,
      totalTasks: results.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      manifestId: manifest.manifest_id,
      verification: verificationSummary,
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
      verification: this.responseVerifier.summary(),
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
  const promptCount = promptCountIndex !== -1 ? parseInt(args[promptCountIndex + 1]) : 50;

  if (!Number.isFinite(promptCount) || promptCount < 1) {
    console.error('Invalid --prompts value. Please pass a positive integer (e.g. --prompts 100).');
    process.exit(1);
  }
  if (promptCount > 500) {
    console.warn(`Warning: ${promptCount} prompts across all configured models will make a large number of real API calls and incur real costs.`);
  }

  const modelsIndex = args.indexOf('--models');
  const models = modelsIndex !== -1 ? args[modelsIndex + 1]?.split(',') : undefined;

  const demoFlag = args.includes('--demo');
  if (demoFlag) {
    process.env.AEO_DEMO_MODE = '1';
    console.log('Demo mode: keyless synthetic responses (no API cost).');
  }

  const orchestrator = new AEOOrchestrator();

  try {
    await orchestrator.initialize();
    const result = await orchestrator.run({ promptCount, models });
    console.log('\n=== AEO Simulation Run Complete ===');
    console.log(JSON.stringify(result.summary, null, 2));
  } catch (error) {
    logger.error('Fatal error in orchestrator', { error: error.message, stack: error.stack });
    if (error instanceof BudgetExceededError) {
      console.error(`\nBudget exceeded: ${error.message}`);
      process.exit(3);
    }
    process.exit(1);
  } finally {
    await orchestrator.cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { AEOOrchestrator };
