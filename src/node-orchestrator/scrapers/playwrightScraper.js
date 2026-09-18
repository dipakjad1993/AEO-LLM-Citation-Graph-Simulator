import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
import { MARKET_LOCALE, normalizeMarket } from '../utils/marketGeo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..', '..');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

export class PlaywrightScraper {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.contexts = {};
    this.stealthMode = config.execution.playwright?.stealth_mode || true;
  }

  async initialize(proxyOverride = null) {
    const launchOptions = {
      headless: this.config.execution.playwright?.headless ?? true,
      args: this.config.execution.playwright?.browser_args || [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox'
      ]
    };

    // Per-market residential proxy rotation: explicit override (from the market
    // group being executed) wins; static config is the fallback. Proxy is a
    // launch-level setting in Playwright — rotation happens via relaunch.
    const proxy = proxyOverride || (this.config.execution.playwright?.proxy?.enabled
      ? {
        server: this.config.execution.playwright.proxy.server,
        username: this.config.execution.playwright.proxy.username,
        password: this.config.execution.playwright.proxy.password
      }
      : null);
    if (proxy?.server) launchOptions.proxy = proxy;
    this.activeProxy = proxy?.server || 'direct';

    this.browser = await chromium.launch(launchOptions);
    logger.info('Playwright browser launched', { proxy: this.activeProxy });
    return this;
  }

  /** Close and relaunch with a different egress proxy (market rotation). No-op if unchanged. */
  async relaunchWithProxy(proxy) {
    const next = proxy?.server || 'direct';
    if (next === this.activeProxy && this.browser) return false;
    try { await this.browser?.close(); } catch {}
    this.contexts = {};
    await this.initialize(proxy);
    return true;
  }

  async getOrCreateContext(targetName, market = null) {
    const mkt = market ? normalizeMarket(market) : null;
    const key = mkt ? `${targetName}::${mkt}` : targetName;
    if (this.contexts[key]) return this.contexts[key];

    const target = this.config.models.playwright_targets?.[targetName];
    if (!target) throw new Error(`Unknown Playwright target: ${targetName}`);

    // Hyper-specific locale/timezone per market: a London buyer sees different
    // retrieval results than an Austin buyer. Falls back to en-US/New_York.
    const loc = (mkt && MARKET_LOCALE[mkt]) || MARKET_LOCALE.US;
    const contextOptions = {
      viewport: this.config.execution.playwright?.viewport || { width: 1920, height: 1080 },
      userAgent: this.config.execution.playwright?.user_agent,
      locale: loc.locale,
      timezoneId: loc.timezone
    };

    const context = await this.browser.newContext(contextOptions);

    if (target.session_file && existsSync(target.session_file)) {
      try {
        const cookies = JSON.parse(readFileSync(target.session_file, 'utf8'));
        await context.addCookies(cookies);
        logger.info(`Loaded session cookies for ${targetName}`);
      } catch (err) {
        logger.warn(`Failed to load session for ${targetName}`, { error: err.message });
      }
    }

    this.contexts[key] = context;
    return context;
  }

  async queryWithRetry(modelId, messages, targetName, opts = {}) {
    // Back-compat: 4th arg may be a legacy maxRetries number.
    const options = typeof opts === 'number' ? { maxRetries: opts } : opts;
    const maxRetries = options.maxRetries || 3;
    const market = options.market || null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeQuery(modelId, messages, targetName, market);
      } catch (error) {
        logger.warn(`Playwright query attempt ${attempt}/${maxRetries} failed`, { error: error.message });
        if (attempt === maxRetries) throw error;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  async executeQuery(modelId, messages, targetName, market = null) {
    const context = await this.getOrCreateContext(targetName, market);
    const page = await context.newPage();

    try {
      if (this.stealthMode) {
        await this.applyStealthMeasures(page);
      }

      const target = this.config.models.playwright_targets[targetName];
      await page.goto(target.url, { waitUntil: 'networkidle', timeout: 30000 });

      if (targetName === 'chatgpt_web') {
        return await this.queryChatGPT(page, messages);
      } else if (targetName === 'claude_web') {
        return await this.queryClaude(page, messages);
      } else if (targetName === 'perplexity_web') {
        return await this.queryPerplexity(page, messages);
      }

      throw new Error(`Unsupported Playwright target: ${targetName}`);
    } finally {
      await page.close();
    }
  }

  async applyStealthMeasures(page) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });
  }

  async queryChatGPT(page, messages) {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMessage) throw new Error('No user message found');

    await page.waitForSelector('[data-testid="text-input"]', { timeout: 15000 });

    const inputArea = await page.$('[data-testid="text-input"]');
    await inputArea.click();
    await page.keyboard.type(lastUserMessage.content, { delay: 10 });

    const sendButton = await page.$('[data-testid="send-button"]');
    await sendButton.click();

    await page.waitForResponse(
      response => response.url().includes('backend-api') && response.status() === 200,
      { timeout: 120000 }
    );

    await page.waitForTimeout(3000);

    const responseText = await page.evaluate(() => {
      const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
      const lastMessage = messages[messages.length - 1];
      return lastMessage?.innerText || '';
    });

    const citations = await page.evaluate(() => {
      const links = document.querySelectorAll('[data-message-author-role="assistant"] a[href]');
      return Array.from(links).map(link => ({
        url: link.href,
        title: link.innerText,
        anchor_text: link.innerText
      })).filter(c => c.url && !c.url.includes('chatgpt.com'));
    });

    const hoverCards = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="hover-card"], [class*="citation"]');
      return Array.from(cards).map(card => card.innerText.substring(0, 200));
    });

    return {
      raw_text: responseText,
      model: 'gpt-4o-web',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: 'stop',
      citations,
      dom_extracted_metadata: { hover_card_sources: hoverCards },
      search_performed: citations.length > 0,
      raw_response: { source: 'playwright', target: 'chatgpt_web' }
    };
  }

  async queryClaude(page, messages) {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMessage) throw new Error('No user message found');

    await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });

    const inputArea = await page.$('[contenteditable="true"]');
    await inputArea.click();

    if (messages.length > 1 && messages[0].role === 'system') {
      await page.keyboard.type(messages[0].content + '\n\n', { delay: 5 });
    }

    await page.keyboard.type(lastUserMessage.content, { delay: 10 });

    await page.waitForTimeout(500);

    const sendButton = await page.$('button[aria-label="Send Message"], button:has(svg)');
    if (sendButton) await sendButton.click();

    await page.waitForTimeout(15000);

    const responseText = await page.evaluate(() => {
      const messages = document.querySelectorAll('[data-is-streaming]');
      const allText = Array.from(document.querySelectorAll('.font-claude-message, [class*="message"]'))
        .map(el => el.innerText);
      return allText[allText.length - 1] || '';
    });

    const citations = await page.evaluate(() => {
      const links = document.querySelectorAll('[class*="message"] a[href]');
      return Array.from(links).map(link => ({
        url: link.href,
        title: link.innerText,
        anchor_text: link.innerText
      })).filter(c => c.url && !c.url.includes('claude.ai'));
    });

    return {
      raw_text: responseText,
      model: 'claude-web',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: 'stop',
      citations,
      dom_extracted_metadata: {},
      search_performed: false,
      raw_response: { source: 'playwright', target: 'claude_web' }
    };
  }

  async queryPerplexity(page, messages) {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMessage) throw new Error('No user message found');

    await page.waitForSelector('textarea, [contenteditable="true"], input[type="text"]', { timeout: 15000 });

    const inputArea = await page.$('textarea, [contenteditable="true"], input[type="text"]');
    await inputArea.click();
    await page.keyboard.type(lastUserMessage.content, { delay: 10 });

    await page.keyboard.press('Enter');

    await page.waitForTimeout(20000);

    const responseText = await page.evaluate(() => {
      const answerEl = document.querySelector('[class*="prose"], [class*="answer"], [class*="response"]');
      return answerEl?.innerText || '';
    });

    const citations = await page.evaluate(() => {
      const sourceElements = document.querySelectorAll('[class*="source"], [class*="citation"], [class*="reference"]');
      return Array.from(sourceElements).map(el => {
        const link = el.querySelector('a[href]');
        return {
          url: link?.href || el.getAttribute('data-url'),
          title: el.innerText.substring(0, 100),
          anchor_text: el.innerText.substring(0, 200)
        };
      }).filter(c => c.url);
    });

    const relatedQuestions = await page.evaluate(() => {
      const rqElements = document.querySelectorAll('[class*="related"] a, [class*="follow-up"] a');
      return Array.from(rqElements).map(el => el.innerText);
    });

    return {
      raw_text: responseText,
      model: 'perplexity-web',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: 'stop',
      citations,
      related_questions: relatedQuestions,
      dom_extracted_metadata: {},
      search_performed: true,
      raw_response: { source: 'playwright', target: 'perplexity_web' }
    };
  }

  async saveSessionCookies(targetName) {
    const context = this.contexts[targetName];
    if (!context) return;

    const target = this.config.models.playwright_targets?.[targetName];
    if (!target?.session_file) return;

    const cookies = await context.cookies();
    writeFileSync(target.session_file, JSON.stringify(cookies, null, 2));
    logger.info(`Saved session cookies for ${targetName}`);
  }

  async cleanup() {
    for (const [name, context] of Object.entries(this.contexts)) {
      try {
        await this.saveSessionCookies(name);
        await context.close();
      } catch (err) {
        logger.warn(`Error closing context ${name}`, { error: err.message });
      }
    }

    if (this.browser) {
      await this.browser.close();
      logger.info('Playwright browser closed');
    }
  }
}
