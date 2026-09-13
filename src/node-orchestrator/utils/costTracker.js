import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..', '..');

export class BudgetExceededError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'BudgetExceededError';
    this.report = report;
  }
}

export class CostTracker {
  static SERP_COST_PER_CALL_USD = 0.005;
  constructor(config, { runId = null } = {}) {
    this.config = config;
    this.tracking = config.execution?.cost_tracking?.enabled ?? true;
    this.dailyBudget = config.execution?.cost_tracking?.daily_budget_usd || 500;
    this.alertThreshold = config.execution?.cost_tracking?.alert_threshold_pct || 80;
    this.costs = [];
    this.totalCost = 0;
    this.costByModel = {};
    this.costByProvider = {};
    this.costByPersona = {};
    this.runId = runId;
    this.sessionCostFile = join(ROOT_DIR, 'data', 'output', 'cost_session.json');
    this.loadExistingSession();
  }

  /** P0 FIX: start a fresh ledger per runId so a stale cost_session.json from a
   *  previous run can't false-trip BudgetExceeded on run #2. */
  reset(runId = null) {
    this.costs = [];
    this.totalCost = 0;
    this.costByModel = {};
    this.costByProvider = {};
    this.costByPersona = {};
    this.runId = runId;
    this.saveSession();
  }

  loadExistingSession() {
    // P0 FIX: only resume a session file that belongs to THIS runId and is fresh
    // (<24h). Otherwise start at $0 — a stale file must never block a new run.
    if (existsSync(this.sessionCostFile)) {
      try {
        const data = JSON.parse(readFileSync(this.sessionCostFile, 'utf8'));
        const ageMs = Date.now() - Date.parse(data.lastUpdated || 0);
        const sameRun = this.runId && data.runId && data.runId === this.runId;
        if (sameRun || ageMs < 0 || Number.isNaN(ageMs) || ageMs > 24 * 3600 * 1000) {
          if (!sameRun) return; // stale or foreign run -> fresh ledger
        }
        this.totalCost = data.totalCost || 0;
        this.costByModel = data.costByModel || {};
        this.costByProvider = data.costByProvider || {};
        this.costByPersona = data.costByPersona || {};
      } catch (err) {
        // ignore
      }
    }
  }

  track(modelConfig, response, { serpCalls = 0 } = {}) {
    if (!this.tracking) return;

    const usage = response.usage || {};
    const inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const outputTokens = usage.completion_tokens || usage.output_tokens || 0;

    const inputCost = (inputTokens / 1000) * (modelConfig.cost_per_1k_input || 0);
    const outputCost = (outputTokens / 1000) * (modelConfig.cost_per_1k_output || 0);
    // P0 FIX: account Grok's self-reported search cost + SERP API per-call cost ($0.005),
    // both previously ignored (spend under-reported).
    const searchCost = Number(usage.search_cost ?? usage.search_cost_usd ?? 0) || 0;
    const serpCost = serpCalls * CostTracker.SERP_COST_PER_CALL_USD +
      (Number(response.serp_surface || response.serp_calls || 0) > 0 && (modelConfig.cost_per_1k_input || 0) === 0
        ? CostTracker.SERP_COST_PER_CALL_USD : 0);
    const totalCost = inputCost + outputCost + searchCost + serpCost;

    this.totalCost += totalCost;

    const modelId = modelConfig.model_id || 'unknown';
    const provider = modelConfig.provider || 'unknown';

    this.costByModel[modelId] = (this.costByModel[modelId] || 0) + totalCost;
    this.costByProvider[provider] = (this.costByProvider[provider] || 0) + totalCost;

    this.costs.push({
      modelId,
      provider,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      searchCost: Number(response.usage?.search_cost ?? response.usage?.search_cost_usd ?? 0) || 0,
      serpCost: totalCost - inputCost - outputCost - (Number(response.usage?.search_cost ?? response.usage?.search_cost_usd ?? 0) || 0),
      totalCost,
      timestamp: new Date().toISOString()
    });

    const pct = (this.totalCost / this.dailyBudget) * 100;
    if (pct > this.alertThreshold) {
      console.warn(`[COST ALERT] Total cost $${this.totalCost.toFixed(4)} exceeds ${this.alertThreshold}% of daily budget $${this.dailyBudget}`);
    }

    this.saveSession();
  }

  /** Returns true when the session still has budget remaining. */
  hasBudget() {
    if (!this.tracking) return true;
    return this.totalCost < this.dailyBudget;
  }

  /** Throws when the hard budget cap has been reached. */
  enforceBudget() {
    if (!this.tracking) return;
    if (!this.hasBudget()) {
      const report = this.getReport();
      throw new BudgetExceededError(
        `Daily budget of $${this.dailyBudget.toFixed(2)} exhausted (spent $${this.totalCost.toFixed(4)}). ` +
        `Set a higher daily_budget_usd in config/execution.json or wait until the budget resets.`,
        report
      );
    }
  }

  /** Estimated cost of a pending request before it is executed. */
  estimateCost(modelConfig, estimatedInputTokens = 1000, estimatedOutputTokens = 1000) {
    if (!this.tracking) return 0;
    return ((estimatedInputTokens / 1000) * (modelConfig.cost_per_1k_input || 0)) +
           ((estimatedOutputTokens / 1000) * (modelConfig.cost_per_1k_output || 0));
  }

  trackPersonaCost(personaId, cost) {
    this.costByPersona[personaId] = (this.costByPersona[personaId] || 0) + cost;
  }

  getReport() {
    return {
      totalCost: this.totalCost,
      dailyBudget: this.dailyBudget,
      budgetRemaining: this.dailyBudget - this.totalCost,
      budgetUtilizationPct: (this.totalCost / this.dailyBudget) * 100,
      costByModel: { ...this.costByModel },
      costByProvider: { ...this.costByProvider },
      costByPersona: { ...this.costByPersona },
      totalRequests: this.costs.length,
      averageCostPerRequest: this.costs.length > 0 ? this.totalCost / this.costs.length : 0,
      costTrend: this.calculateCostTrend(),
      estimatedCostFor5000: this.totalCost > 0 ? (this.totalCost / Math.max(this.costs.length, 1)) * 5000 : 0
    };
  }

  calculateCostTrend() {
    if (this.costs.length < 10) return 'insufficient_data';
    const mid = Math.floor(this.costs.length / 2);
    const firstHalf = this.costs.slice(0, mid).reduce((s, c) => s + c.totalCost, 0) / mid;
    const secondHalf = this.costs.slice(mid).reduce((s, c) => s + c.totalCost, 0) / (this.costs.length - mid);
    const change = ((secondHalf - firstHalf) / firstHalf) * 100;
    return { firstHalfAvg: firstHalf, secondHalfAvg: secondHalf, changePct: change, direction: change > 0 ? 'increasing' : 'decreasing' };
  }

  saveSession() {
    try {
      writeFileSync(this.sessionCostFile, JSON.stringify({
        runId: this.runId,
        totalCost: this.totalCost,
        costByModel: this.costByModel,
        costByProvider: this.costByProvider,
        costByPersona: this.costByPersona,
        lastUpdated: new Date().toISOString()
      }, null, 2));
    } catch (err) {
      // ignore
    }
  }
}
