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
  constructor(config) {
    this.config = config;
    this.tracking = config.execution?.cost_tracking?.enabled ?? true;
    this.dailyBudget = config.execution?.cost_tracking?.daily_budget_usd || 500;
    this.alertThreshold = config.execution?.cost_tracking?.alert_threshold_pct || 80;
    this.costs = [];
    this.totalCost = 0;
    this.costByModel = {};
    this.costByProvider = {};
    this.costByPersona = {};
    this.sessionCostFile = join(ROOT_DIR, 'data', 'output', 'cost_session.json');
    this.loadExistingSession();
  }

  loadExistingSession() {
    if (existsSync(this.sessionCostFile)) {
      try {
        const data = JSON.parse(readFileSync(this.sessionCostFile, 'utf8'));
        this.totalCost = data.totalCost || 0;
        this.costByModel = data.costByModel || {};
        this.costByProvider = data.costByProvider || {};
        this.costByPersona = data.costByPersona || {};
      } catch (err) {
        // ignore
      }
    }
  }

  track(modelConfig, response) {
    if (!this.tracking) return;

    const usage = response.usage || {};
    const inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const outputTokens = usage.completion_tokens || usage.output_tokens || 0;

    const inputCost = (inputTokens / 1000) * (modelConfig.cost_per_1k_input || 0);
    const outputCost = (outputTokens / 1000) * (modelConfig.cost_per_1k_output || 0);
    const totalCost = inputCost + outputCost;

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
