import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
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
import {
  normalizeMarket, parseMarket, resolveMarkets, resolveProxyForMarket,
  pairSnapshots, resolveProviderForSnapshot, PROMPT_SCALES, shardSessions
} from './utils/marketGeo.js';
import { RateLimiter } from './utils/rateLimiter.js';
import { ResponseVerifier } from './utils/responseVerifier.js';
import { validateAllConfigs, ConfigError } from '../../config/validator.js';
import {
  buildResultProvenance,
  buildRunManifest,
  writeManifest,
  appendAuditEntry,
  persistRawResponse,
  privacyFlags,
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
    this.costTracker = new CostTracker(this.config, { runId: this.runId });
    this.responseVerifier = new ResponseVerifier(this.config, {
      online: this.config.execution?.verification?.citation_http_check !== false,
      concurrency: this.config.execution?.verification?.citation_concurrency || 8
    });
    this.rateLimiters = {};
    this._providerCache = new Map();
    this.apiQueue = new PQueue({ concurrency: this.config.execution.max_concurrent_api });
    this.playwrightQueue = new PQueue({ concurrency: this.config.execution.max_concurrent_playwright });
    this.results = [];
    this.sessionId = uuidv4();
    this.runId = randomRunId();
    this.startTime = null;
    // Enterprise system inputs (first-page form -> /api/config -> system_inputs.json).
    // Until this file exists the orchestrator runs on config-file defaults and says so.
    this.sysInputs = {};
    this.sysInputsSource = 'config defaults (no system_inputs.json found)';
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

  loadSystemInputs() {
    // Precedence: run-dir uploads > data/uploads/system_config/ > data/system_inputs.json.
    // Written by server.js POST /api/config from the System Inputs form. Never
    // throws: a missing file means "run on config defaults", logged honestly.
    const candidates = [
      join(ROOT_DIR, 'data', 'uploads', 'system_config', 'system_inputs.json'),
      join(ROOT_DIR, 'data', 'system_inputs.json')
    ];
    for (const p of candidates) {
      try {
        if (existsSync(p)) {
          this.sysInputs = JSON.parse(readFileSync(p, 'utf8'));
          this.sysInputsSource = p;
          logger.info(`System inputs loaded from ${p}`, {
            markets: this.sysInputs?.geo_localization?.markets,
            temporal: this.sysInputs?.temporal_grounding?.compare_mode,
            ragCapture: this.sysInputs?.dynamic_search_context?.capture_hidden_queries
          });
          return this.sysInputs;
        }
      } catch (err) {
        logger.warn(`Ignoring unreadable system inputs at ${p}`, { error: err.message });
      }
    }
    this.sysInputs = {};
    this.sysInputsSource = 'config defaults (no system_inputs.json found)';
    logger.info('No system_inputs.json — running on config-file defaults (geo/temporal/RAG layers inactive)');
    return this.sysInputs;
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

    // Enterprise layers: RAG / temporal / geo inputs from the System Inputs form.
    this.loadSystemInputs();

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
      const serpLimits = this.config.execution?.rate_limiting?.serp || { rpm: 60, tpm: 32000 };
      this.providers.microsoft = new CopilotProvider(apiKeyMap.serp, this.config);
      this.providers['google-serp'] = new AIOverviewsProvider(apiKeyMap.serp, this.config);
      // P0 FIX: AI Mode is a SEPARATE surface (AIO/AI-Mode share only ~13.7% citations).
      // It was imported but never instantiated, so models.json ai-mode was silently skipped.
      this.providers['ai-mode'] = new AIModeProvider(apiKeyMap.serp, this.config);
      this.rateLimiters.microsoft = new RateLimiter(this.config.execution?.rate_limiting?.microsoft || serpLimits);
      this.rateLimiters['google-serp'] = new RateLimiter(this.config.execution?.rate_limiting?.['google-serp'] || serpLimits);
      this.rateLimiters['ai-mode'] = new RateLimiter(this.config.execution?.rate_limiting?.['ai-mode'] || serpLimits);
      logger.info('SERP providers initialized (Copilot + AI Overviews + AI Mode)');
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

    // Prompt scale presets: pilot 50 / standard 500 / enterprise 5000.
    // 5000 sessions NEVER run in one shot: shard across executions (prompt_shard)
    // and pass the hard budget gate below.
    const scaleName = options.scale || this.config.execution?.prompt_scale || null;
    const scalePreset = scaleName && PROMPT_SCALES[scaleName] ? PROMPT_SCALES[scaleName] : null;
    const targetSessions = options.promptCount
      || (scalePreset ? scalePreset.promptCount : null)
      || this.config.execution.prompt_count || 50;
    if (scalePreset) logger.info(`Prompt scale '${scaleName}': ${scalePreset.description}`);

    // Hyper-specific markets (US-NY, UK-LND, APAC-SGP) from the System Inputs
    // form; falls back to execution.geo.countries. Budget is SPLIT across
    // markets (cost-flat), each session tagged with market + country.
    const markets = resolveMarkets(this.sysInputs, this.config.execution?.geo);
    const perMarket = Math.max(1, Math.ceil(targetSessions / markets.length));
    let prompts = [];
    for (const market of markets) {
      const parsed = parseMarket(market);
      const batch = await this.promptGenerator.generateAllPrompts(perMarket, options.personas || undefined);
      for (const s of batch) { s.market = parsed.market; s.geo = parsed.country; }
      prompts.push(...batch);
    }
    prompts = prompts.slice(0, targetSessions);

    // Temporal paired A/B: duplicate sessions tagged baseline/current when the
    // form requests paired compare with two exact snapshot IDs.
    const temporal = this.sysInputs?.temporal_grounding || {};
    prompts = pairSnapshots(prompts, temporal);
    if (prompts.length && prompts[0].snapshotModel) {
      logger.info(`Temporal paired mode: ${temporal.baseline_model_snapshot} vs ${temporal.current_model_snapshot} (${prompts.length} tagged sessions)`);
    }

    // Sharding for enterprise scale: --shard 2/5 runs a deterministic slice.
    const shardIndex = options.shard || this.config.execution?.prompt_shard?.index || 1;
    const shardTotal = options.shards || this.config.execution?.prompt_shard?.total || 1;
    if (shardTotal > 1) {
      const before = prompts.length;
      prompts = shardSessions(prompts, shardIndex, shardTotal);
      logger.info(`Shard ${shardIndex}/${shardTotal}: ${prompts.length} of ${before} sessions in this execution`);
    }
    logger.info(`Generated ${prompts.length} multi-turn prompt sessions across markets: ${markets.join(',')} (inputs: ${this.sysInputsSource})`);

    // Pre-flight budget gate: refuse (loudly, with numbers) instead of dying mid-run.
    const est = this.estimatePlanCost(prompts);
    const budget = this.config.execution?.cost_tracking?.daily_budget_usd || 500;
    logger.info(`Cost estimate: ~${est.calls} calls, ~$${est.estimatedTotal.toFixed(2)} vs $${budget}/day budget`);
    if (est.estimatedTotal > budget) {
      throw new Error(`BUDGET GATE: estimated $${est.estimatedTotal.toFixed(2)} exceeds daily budget $${budget} for ${est.calls} calls. Shard the run (--shard i/n), cut --prompts, or raise cost_tracking.daily_budget_usd.`);
    }

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
    // P0 FIX: hard stop on fan-out explosion (50 prompts*4 turns*11 models*5 reps*2 twins
    // ~= 22k calls would trip the $500 budget mid-run). Truncate deterministically.
    const maxCalls = this.config.execution?.max_calls_per_run || 2500;
    // Volatility: repeat money prompts N times to measure answer variance (AIO shifts ~70% on repeat).
    const vol = this.config.execution?.volatility || {};
    const repeats = Math.max(1, Math.min(vol.repeats || 1, 10));

    for (const promptSession of prompts) {
      const shouldUsePlaywright = mode !== 'api_only' && this.playwrightScraper && Math.random() < playwrightSampleRate;
      // Full, deterministic coverage: every configured API model answers every prompt.
      const models = this.selectModelsForPrompt(promptSession);
      const market = promptSession.market || promptSession.geo || 'US';
      const snapshot = promptSession.snapshot || 'current';

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
            modelId: promptSession.snapshotModel && snapshot === 'baseline' ? promptSession.snapshotModel : modelId,
            registryModelId: modelId,
            snapshot,
            market,
            provider: this.getProviderForModel(promptSession.snapshotModel && snapshot === 'baseline' ? promptSession.snapshotModel : modelId) || provider,
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
              registryModelId: modelId,
              snapshot,
              market,
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

    if (plan.length > maxCalls) {
      logger.warn(`Execution plan has ${plan.length} calls; truncating to max_calls_per_run=${maxCalls}. ` +
        `Reduce prompt_count, volatility.repeats, models, or raise max_calls_per_run.`);
      // Keep high-priority (turn 0 + RAG-on) tasks first, drop twins/repeats from the tail.
      const pri = (t) => (t.priority === 'high' ? 0 : t.ragEnabled ? 1 : 2);
      plan.sort((a, b) => pri(a) - pri(b));
      return plan.slice(0, maxCalls);
    }
    return plan;
  }

  selectModelsForPrompt(promptSession) {
    const allModelIds = [];
    const modelsConfig = this.config.models.models;
    // Runtime refusal: retired IDs (shutdown 2026-07-23 web_search_preview etc.) are never
    // scheduled even if left in the registry. Validator also fails CI on them.
    const retired = new Set(
      Object.values(this.config.models.deprecated || {}).map((d) => d?.model_id).filter(Boolean)
    );
    // Unverified late-2026 candidates are never scheduled until flipped to scheduled:true.
    const blocked = (mc) => retired.has(mc?.model_id) || (mc?.scheduled === false && mc?.registry_status === 'unverified');

    for (const [providerName, providerModels] of Object.entries(modelsConfig)) {
      for (const [modelId, modelConfig] of Object.entries(providerModels)) {
        if (blocked(modelConfig)) {
          logger.warn(`Skipping retired/unverified model ${providerName}.${modelId} (not scheduled)`);
          continue;
        }
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
    if (this._providerCache?.has(modelId)) return this._providerCache.get(modelId);
    const modelsConfig = this.config.models.models;
    for (const [providerName, providerModels] of Object.entries(modelsConfig)) {
      if (providerModels[modelId] && this.providers[providerName]) {
        const hit = { name: providerName, modelConfig: providerModels[modelId], instance: this.providers[providerName] };
        this._providerCache.set(modelId, hit);
        return hit;
      }
    }
    // Snapshot-ID fallback: user-supplied temporal snapshot IDs (e.g. gpt-4o-2025-03-26)
    // are not registry keys. Resolve by model family and borrow that provider's
    // instance with a synthetic config — logged once, never silent.
    const fallbackName = resolveProviderForSnapshot(modelId, this.providers);
    if (fallbackName) {
      logger.info(`Snapshot model '${modelId}' resolved to provider '${fallbackName}' by family fallback`);
      const hit = {
        name: fallbackName,
        modelConfig: { model_id: modelId, display_name: `${modelId} (snapshot)`, supports_web_search: true, supports_seed: false, max_tokens: 4096, temperature_range: [0, 2], supports_system_message: true },
        instance: this.providers[fallbackName]
      };
      this._providerCache.set(modelId, hit);
      return hit;
    }
    return null;
  }

  estimatePlanCost(prompts) {
    // Pre-flight cost guard: estimate worst-case spend before any paid call.
    const models = this.selectModelsForPrompt({});
    let perCall = 0;
    for (const m of models) {
      const cfg = this.getProviderForModel(m)?.modelConfig;
      if (cfg) perCall += this.costTracker.estimateCost(cfg, 1500, 800);
    }
    perCall = models.length ? perCall / models.length : 0.035;
    const turns = this.config.execution?.multi_turn_fallback_turns || 4;
    return { estimatedCalls: prompts.length * turns * Math.max(models.length, 1), perCall, estimatedTotal: prompts.length * turns * Math.max(models.length, 1) * perCall };
  }

  async executePlan(plan) {
    const results = [];
    const batchedPlan = this.batchByPriority(plan);
    // History cache: `${sessionId}::${modelId}::${channel}` -> Map(turnIndex -> preview text).
    // executeTask stores each completed turn's preview here; buildMessages reads it back,
    // so multi-turn prompts chain REAL assistant history (single-turn fan-out is no more).
    this._historyCache = new Map();

    for (const batch of batchedPlan) {
      await this.rotateProxyForBatch(batch);
      const batchResults = await Promise.allSettled(
        batch.tasks.map(task => this.executeTask(task))
      );
      const mapped = batchResults.map((r, i) => ({
        ...batch.tasks[i],
        result: r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : null,
        status: r.status
      }));
      for (const item of mapped) {
        if (item.status === 'fulfilled' && item.result?.raw_text) {
          const key = `${item.promptSession?.sessionId}::${item.modelId}::${item.usePlaywright ? 'web_ui' : 'api'}::${item.ragEnabled ? 'rag' : 'base'}`;
          if (!this._historyCache.has(key)) this._historyCache.set(key, new Map());
          // Keep preview bounded (first 1500 chars) to control context growth.
          this._historyCache.get(key).set(item.turn?.turnIndex, String(item.result.raw_text).slice(0, 1500));
        }
      }
      results.push(...mapped);
    }

    return results;
  }

  async rotateProxyForBatch(batch) {
    // Residential proxy rotation is per market GROUP (Playwright proxy is
    // launch-level — it cannot change per request). Batches are market-mixed,
    // so rotate on the majority market and skip relaunch when unchanged.
    if (!this.playwrightScraper) return;
    const counts = {};
    for (const t of batch.tasks || []) {
      const m = normalizeMarket(t.market || t.promptSession?.market || t.promptSession?.geo || 'US');
      counts[m] = (counts[m] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'US';
    const { proxy, source } = resolveProxyForMarket(top, this.config.execution);
    try {
      const changed = await this.playwrightScraper.relaunchWithProxy(proxy);
      logger.info(`Playwright egress for market ${top}: ${proxy?.server ? proxy.server : 'direct'} (source: ${source}${changed ? ', relaunched' : ', reused'})`);
    } catch (err) {
      logger.warn(`Proxy rotation failed for market ${top} — continuing on current egress`, { error: err.message });
    }
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

    this._currentTaskKey = `${promptSession?.sessionId}::${modelId}::${usePlaywright ? 'web_ui' : 'api'}::${ragEnabled ? 'rag' : 'base'}`;
    this._currentModelId = modelId;
    const messages = this.buildMessages(promptSession, turn, ragEnabled);
    const modelConfig = provider.modelConfig;
    const temperature = this.config.execution.temperature || 0.15;
    // Enterprise layers from System Inputs (empty object = config defaults).
    const ragCfg = this.sysInputs?.dynamic_search_context || {};
    const market = parseMarket(task.market || promptSession?.market || promptSession?.geo || 'US');

    let response;

    if (usePlaywright && this.playwrightScraper) {
      response = await this.playwrightQueue.add(async () => {
        const browserTarget = this.selectPlaywrightTarget(modelId);
        return await this.playwrightScraper.queryWithRetry(modelId, messages, browserTarget, { market: market.market });
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
            // P0 FIX: model registry max_tokens is CONTEXT window (128k-1M). Sending it as
            // max_output_tokens causes 400s / runaway bills. Cap completion tokens at 4096.
            max_tokens: Math.min(this.config.execution.max_tokens || modelConfig.max_tokens || 1024, 4096),
            top_p: this.config.execution.top_p || 0.9,
            // P0 FIX: fixed seed:42 destroys repeat-variance measurement. Only seed when
            // volatility is disabled AND deterministic runs are explicitly requested.
            seed: (modelConfig.supports_seed && !this.config.execution?.volatility?.enabled && this.config.execution?.deterministic === true) ? 42 : undefined,
            // P0 FIX: RAG-off twin must be a TRUE memory baseline. Perplexity always
            // searches server-side, so force tool_choice:none + search_enabled:false.
            search_enabled: ragEnabled ? Boolean(modelConfig.supports_web_search) : false,
            tool_choice: ragEnabled ? (this.config.execution?.search_options?.tool_choice || 'auto') : 'none',
            allowed_domains: this.config.execution?.search_options?.allowed_domains || [],
            search_context_size: this.config.execution?.search_options?.search_context_size || 'medium',
            // Enterprise RAG layer: cap + templates ride along where the provider
            // API supports them; every row records what was requested (analysis
            // compares requested vs actually-retrieved — the invalidation vector).
            max_search_queries: ragCfg.max_search_queries_per_prompt || undefined,
            query_templates: ragCfg.query_templates || undefined,
            source_priority: ragCfg.source_priority || undefined,
            geo: market.country,
            market: market.market,
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

    let fanoutLocal = [];
    try {
      const { fanoutSubqueries } = await import('./utils/fanout.js');
      fanoutLocal = fanoutSubqueries(turn.prompt, { maxSub: 6 });
    } catch { fanoutLocal = []; }

    const extracted = this.responseExtractor.extract(response, {
      modelId,
      turnIndex: turn.turnIndex,
      executionId,
      ragEnabled,
      promptSession,
      entityConfig: this.config.entityMaps
    });

    this.costTracker.track(modelConfig, response, { serpCalls: provider.name === 'microsoft' || provider.name === 'google-serp' || provider.name === 'ai-mode' ? 1 : 0 });

    // Fan-out join: provider-reported queries (engine truth) + local decomposition
    // (labeled, never disguised). Powers the rerank + volatility analysis.
    const providerFanout = response.fanout_queries || response.hidden_search_queries || [];
    extracted.fanout_queries = [
      ...providerFanout.map((q) => (typeof q === 'string' ? { query: q, origin: 'provider_reported' } : q)),
      ...fanoutLocal,
    ];
    extracted.geo = market.country;
    extracted.market = market.market;
    extracted.snapshot = task.snapshot || promptSession?.snapshot || 'current';
    extracted.location_code = response.location_code || null;
    extracted.location_source = response.location_source || null;
    extracted.geo_applied = {
      market: market.market, country: market.country,
      provider: provider.name,
      retrieval_geo: ['anthropic', 'microsoft', 'google-serp', 'ai-mode'].includes(provider.name)
        ? 'user_location/location_code sent'
        : 'provider API exposes no retrieval-location control — market tag + Playwright locale/proxy carry geo'
    };

    return extracted;
  }

  buildMessages(promptSession, turn, ragEnabled) {
    const messages = [];
    const persona = this.config.personas.personas.find(p => p.persona_id === promptSession.personaId);

    if (persona && ragEnabled) {
      messages.push({ role: 'system', content: persona.system_instruction_bias });
    }

    // Chained history: prefer live cache (real assistant output from this run), fall back
    // to any pre-seeded context.responsePreview on the turn definition.
    const histKey = `${promptSession?.sessionId}::${this._currentModelId || ''}`;
    for (let i = 0; i < turn.turnIndex; i++) {
      messages.push({ role: 'user', content: promptSession.turns[i].prompt });
      let preview = promptSession.turns[i].context?.responsePreview || null;
      if (this._historyCache) {
        for (const [key, turns] of this._historyCache) {
          if (key.startsWith(`${promptSession?.sessionId}::`) && turns.has(i)) {
            // Match the same model+channel+rag lane when possible.
            if (!this._currentTaskKey || key === this._currentTaskKey) { preview = turns.get(i); break; }
            preview = preview || turns.get(i);
          }
        }
      }
      if (preview) messages.push({ role: 'assistant', content: preview });
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
    // RAG capture gate: when the form disables hidden-query capture, provider-
    // reported queries are stripped at persist time (privacy). Our own local
    // fan-out decomposition is always kept and always labeled as such.
    const captureHidden = this.sysInputs?.dynamic_search_context?.capture_hidden_queries !== false;
    const processedResults = results.map(r => ({
      executionId: r.executionId,
      promptSessionId: r.promptSession?.sessionId,
      personaId: r.promptSession?.personaId,
      modelId: r.modelId,
      registryModelId: r.registryModelId || r.modelId,
      snapshot: r.snapshot || r.result?.snapshot || r.promptSession?.snapshot || 'current',
      provider: r.provider?.name,
      turnIndex: r.turn?.turnIndex,
      turnType: r.turn?.turnType,
      prompt: r.turn?.prompt,
      ragEnabled: r.ragEnabled,
      volatilityRep: r.volatilityRep || 0,
      channel: r.usePlaywright ? 'web_ui' : 'api',
      hidden_search_queries: captureHidden ? (r.result?.hidden_search_queries || []) : [],
      fanout_queries: (r.result?.fanout_queries || []).filter((q) => captureHidden || q?.origin !== 'provider_reported'),
      rag_capture: captureHidden ? 'on' : 'off (provider queries stripped at persist)',
      geo: r.result?.geo || r.promptSession?.geo || 'us',
      market: r.result?.market || r.market || r.promptSession?.market || 'US',
      location_code: r.result?.location_code || null,
      location_source: r.result?.location_source || null,
      geo_applied: r.result?.geo_applied || null,
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
        const priv = privacyFlags(this.config);
        try {
          persistRawResponse(this.runDir, {
            executionId: r.executionId,
            provider: r.provider?.name,
            raw: r.result.raw_response
          }, { hashOnly: priv.hashOnlyRaw, redact: priv.redactPersisted });
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

  const scaleIndex = args.indexOf('--scale');
  const scale = scaleIndex !== -1 ? args[scaleIndex + 1] : undefined;
  if (scale && !PROMPT_SCALES[scale]) {
    console.error(`Invalid --scale '${scale}'. Choose: ${Object.keys(PROMPT_SCALES).join(', ')}.`);
    process.exit(1);
  }

  const shardIndex = args.indexOf('--shard');
  const shard = shardIndex !== -1 ? args[shardIndex + 1] : undefined; // "2/5"
  let shardNum, shardTotal;
  if (shard) {
    const m = String(shard).match(/^(\d+)\/(\d+)$/);
    if (!m) { console.error('Invalid --shard. Use --shard 2/5 (index/total).'); process.exit(1); }
    shardNum = parseInt(m[1], 10); shardTotal = parseInt(m[2], 10);
  }

  const demoFlag = args.includes('--demo');
  if (demoFlag) {
    process.env.AEO_DEMO_MODE = '1';
    console.log('Demo mode: keyless synthetic responses (no API cost).');
  }

  const orchestrator = new AEOOrchestrator();

  try {
    await orchestrator.initialize();
    const result = await orchestrator.run({ promptCount, models, scale, shard: shardNum, shards: shardTotal });
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

// P0 FIX: import.meta.url === 'file://...' string compare breaks on Windows
// (backslashes / drive letters). Use pathToFileURL for a canonical comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { AEOOrchestrator };
