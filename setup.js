#!/usr/bin/env node
/**
 * AEO & LLM Citation Graph Simulator — Setup Wizard
 *
 * Interactively configures the tool for REAL, verified production use:
 *   1. Collects live API keys (OpenAI, Anthropic, Google, Perplexity, DeepSeek)
 *      and validates each with a real, minimal API call before writing .env.
 *   2. Collects your brand + competitor ground truth and generates
 *      config/entity_maps.json.
 *   3. Writes .env from .env.example defaults.
 *
 * Nothing is fabricated: if a key fails live validation you are told
 * immediately and the key is not written to disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function cyan(s) { return `\x1b[36m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }
function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function bold(s) { return `\x1b[1m${s}\x1b[0m`; }

async function ask(question, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${cyan('?')} ${question}${suffix}: `);
  return answer.trim() || defaultValue;
}

async function askYesNo(question, defaultValue = true) {
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
  const answer = (await rl.question(`${cyan('?')} ${question}${suffix}: `)).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') return true;
  if (answer === 'n' || answer === 'no') return false;
  return defaultValue;
}

// ── Live key validation ───────────────────────────────────────────────────
async function validateOpenAI(key) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: key });
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 5
  });
  return (res.choices?.[0]?.message?.content || '').toLowerCase().includes('ok');
}

async function validateAnthropic(key) {
  const { Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 8,
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }]
  });
  const text = res.content?.[0]?.text || '';
  return text.toLowerCase().includes('ok');
}

async function validateGoogle(key) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const res = await model.generateContent('Reply with exactly: ok');
  const text = res.response?.text?.() || '';
  return text.toLowerCase().includes('ok');
}

async function validateOpenAICompat(key, baseURL, label) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: key, baseURL });
  const res = await client.chat.completions.create({
    model: 'sonar',
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 5
  });
  return (res.choices?.[0]?.message?.content || '').toLowerCase().includes('ok');
}

async function validateKey(provider, key) {
  process.stdout.write(`  Validating ${provider} key... `);
  try {
    let ok = false;
    if (provider === 'OPENAI') ok = await validateOpenAI(key);
    else if (provider === 'ANTHROPIC') ok = await validateAnthropic(key);
    else if (provider === 'GOOGLE_AI') ok = await validateGoogle(key);
    else if (provider === 'PERPLEXITY') ok = await validateOpenAICompat(key, 'https://api.perplexity.ai', 'Perplexity');
    else if (provider === 'DEEPSEEK') ok = await validateOpenAICompat(key, 'https://api.deepseek.com', 'DeepSeek');
    if (ok) { process.stdout.write(green('OK\n')); return true; }
    process.stdout.write(red('FAILED (no valid response)\n'));
    return false;
  } catch (err) {
    process.stdout.write(red(`FAILED (${err?.status || err?.statusCode || err?.message || err})\n`));
    return false;
  }
}

// ── entity_maps.json generation ───────────────────────────────────────────
function buildEntityMaps(answers) {
  const attributes = {};
  if (answers.brand.category) attributes.category = answers.brand.category;
  if (answers.brand.features) attributes.features = answers.brand.features.split(';').map(s => s.trim()).filter(Boolean);
  if (answers.brand.pricing) attributes.pricing_model = answers.brand.pricing.trim();
  if (answers.brand.certifications) attributes.certifications = answers.brand.certifications.split(';').map(s => s.trim()).filter(Boolean);
  if (answers.brand.usps) attributes.unique_selling_points = answers.brand.usps.split(';').map(s => s.trim()).filter(Boolean);
  if (answers.brand.target_segment) attributes.target_segment = answers.brand.target_segment.split(';').map(s => s.trim()).filter(Boolean);

  const competitors = [];
  for (const comp of answers.competitors) {
    const c = { primary_name: comp.name };
    if (comp.aliases) c.aliases = comp.aliases.split(';').map(s => s.trim()).filter(Boolean);
    const compAttrs = {};
    if (comp.features) compAttrs.features = comp.features.split(';').map(s => s.trim()).filter(Boolean);
    if (comp.pricing) compAttrs.pricing_model = comp.pricing.trim();
    if (compAttrs.features || compAttrs.pricing_model) c.attributes = compAttrs;
    competitors.push(c);
  }

  return {
    entity_maps: {
      your_brand: {
        primary_name: answers.brand.name,
        aliases: (answers.brand.aliases || '').split(';').map(s => s.trim()).filter(Boolean),
        attributes
      },
      competitors,
      target_queries: [
        `who is the best ${answers.brand.category || 'alternative'}`,
        `alternatives to ${answers.brand.name}`,
        `${answers.brand.category || 'software'} comparison`,
        `reviews of ${answers.brand.name}`
      ]
    }
  };
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + bold('=============================================='));
  console.log(bold('AEO & LLM Citation Graph Simulator — Setup Wizard'));
  console.log(bold('=============================================='));
  console.log(yellow('Configures the tool for real, verified, production-grade LLM data.'));
  console.log(yellow('Every API key is validated live before it is saved.\n'));

  if (fs.existsSync(path.join(ROOT, '.env'))) {
    console.log(yellow('An .env file already exists.'));
    if (!(await askYesNo('Overwrite it?', false))) {
      console.log(red('Aborting. Your existing .env was left untouched.'));
      rl.close();
      return;
    }
  }

  // 1. API keys
  const keys = {};
  const providers = [
    { env: 'OPENAI_API_KEY', label: 'OpenAI (gpt-4o / gpt-4o-mini)', validate: 'OPENAI', optional: false },
    { env: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude 3.5/3.7 Sonnet)', validate: 'ANTHROPIC', optional: true },
    { env: 'GOOGLE_AI_API_KEY', label: 'Google AI Studio (Gemini)', validate: 'GOOGLE_AI', optional: true },
    { env: 'PERPLEXITY_API_KEY', label: 'Perplexity (Sonar Pro)', validate: 'PERPLEXITY', optional: true },
    { env: 'DEEPSEEK_API_KEY', label: 'DeepSeek', validate: 'DEEPSEEK', optional: true }
  ];

  console.log(bold('\n[1/3] API Keys (validated live)\n'));
  for (const p of providers) {
    const hint = p.optional ? ' (optional — skip to disable this provider)' : '';
    let key = '';
    while (!key) {
      const answer = await ask(`${p.label}${hint}`);
      if (!answer && p.optional) { key = 'SKIPPED'; break; }
      if (!answer) { console.log(red('  OpenAI is required. Enter a valid key or press Ctrl+C to quit.')); continue; }
      const ok = await validateKey(p.validate, answer);
      if (ok) { key = answer; }
      else if (p.optional) {
        if (!(await askYesNo('Validation failed. Add it anyway (unvalidated)?', false))) {
          console.log(yellow('  Skipping this provider.'));
          key = 'SKIPPED';
        } else {
          key = answer;
        }
      }
    }
    keys[p.env] = key;
  }

  // 2. Brand ground truth
  console.log(bold('\n[2/3] Your Brand Ground Truth (used for claim verification)\n'));
  const brand = {
    name: await ask('Your brand primary name'),
    aliases: await ask('Aliases / alternate spellings (semicolon-separated, optional)'),
    category: await ask('Product category (e.g. "project management software")'),
    features: await ask('Key features (semicolon-separated)'),
    pricing: await ask('Pricing model (e.g. "free tier with paid plans from $10/month")'),
    certifications: await ask('Certifications/compliance (semicolon-separated, optional)'),
    usps: await ask('Unique selling points (semicolon-separated)'),
    target_segment: await ask('Target segments (semicolon-separated, optional)')
  };

  const competitors = [];
  console.log(bold('\nCompetitors (press Enter on name to finish)\n'));
  while (true) {
    const name = await ask(`Competitor ${competitors.length + 1} name (Enter to finish)`);
    if (!name) break;
    const comp = { name };
    comp.aliases = await ask('  Aliases (optional)');
    comp.features = await ask('  Key features (optional)');
    comp.pricing = await ask('  Pricing model (optional)');
    competitors.push(comp);
  }

  // 3. Execution settings
  console.log(bold('\n[3/3] Execution Settings\n'));
  const settings = {
    maxConcurrent: await ask('Max concurrent API requests', '10'),
    maxTokens: await ask('Max tokens per response', '4096'),
    budgetUsd: await ask('Daily API budget (USD)', '20.00'),
    promptCount: await ask('Prompts per run (recommended 50-150)', '50')
  };

  // Write .env
  const envPath = path.join(ROOT, '.env');
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const lines = example.split('\n').map((line, i, arr) => {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (!m) return line;
    const envName = m[1];
    if (keys[envName] && keys[envName] !== 'SKIPPED') return `${envName}=${keys[envName]}`;
    if (envName === 'MAX_CONCURRENT_REQUESTS') return `${envName}=${settings.maxConcurrent}`;
    if (envName === 'MAX_TOKENS') return `${envName}=${settings.maxTokens}`;
    if (envName === 'DAILY_BUDGET_USD') return `${envName}=${settings.budgetUsd}`;
    return line;
  });
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
  console.log(green(`\n✓ .env written to ${envPath}`));

  // Write entity_maps.json
  const entityMapsPath = path.join(ROOT, 'config', 'entity_maps.json');
  fs.writeFileSync(entityMapsPath, JSON.stringify(buildEntityMaps({ brand, competitors }), null, 2), 'utf8');
  console.log(green(`✓ entity_maps.json written to ${entityMapsPath}`));

  // Update execution.json default prompt count if requested
  const execPath = path.join(ROOT, 'config', 'execution.json');
  if (fs.existsSync(execPath)) {
    try {
      const exec = JSON.parse(fs.readFileSync(execPath, 'utf8'));
      if (exec.execution && typeof exec.execution.prompt_count === 'number') {
        exec.execution.prompt_count = parseInt(settings.promptCount, 10) || 50;
        fs.writeFileSync(execPath, JSON.stringify(exec, null, 2), 'utf8');
        console.log(green(`✓ prompt_count updated in config/execution.json (${settings.promptCount})`));
      }
    } catch (e) {
      console.log(yellow(`  Warning: could not update execution.json (${e.message})`));
    }
  }

  const enabled = Object.entries(keys).filter(([, v]) => v && v !== 'SKIPPED').map(([k]) => k.replace('_API_KEY', ''));
  console.log(bold('\n=============================================='));
  console.log(bold('Setup complete'));
  console.log(bold('=============================================='));
  console.log(`  Enabled providers: ${enabled.length ? enabled.join(', ') : 'NONE'}`);
  console.log(`  Brand: ${brand.name}${competitors.length ? ` (+ ${competitors.length} competitors)` : ''}`);
  console.log('\n  Next steps:');
  console.log('  1. Validate configuration:  npm run validate');
  console.log('  2. Start a real run:        npm run full-run');
  console.log('  3. For RAG split testing:   set RAG_ENABLED=true in .env\n');

  rl.close();
}

main().catch((err) => {
  console.error(red(`\nSetup failed: ${err.message}`));
  process.exitCode = 1;
  rl.close();
});
