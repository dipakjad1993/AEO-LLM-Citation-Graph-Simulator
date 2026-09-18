/**
 * marketGeo.js — enterprise collection wiring (pure, hermetic-tested).
 * Turns the System Inputs form (dynamic_search_context, temporal_grounding,
 * geo_localization) from saved JSON into executed collection behavior:
 *  - hyper-specific market rotation (US-NY, UK-LND, APAC-SGP) with per-market
 *    residential proxy resolution + Playwright locale/timezone mapping
 *  - paired snapshot A/B (baseline vs current model IDs) for temporal drift
 *  - prompt scale presets (pilot/standard/enterprise-5000) with sharding
 *  - snapshot-ID -> provider fallback resolution (snapshot IDs are user-supplied
 *    exact IDs, not registry keys)
 */

export const MARKET_LOCALE = {
  'US-NY': { locale: 'en-US', timezone: 'America/New_York', country: 'us' },
  'US-AUS': { locale: 'en-US', timezone: 'America/Chicago', country: 'us' },
  'US-SFO': { locale: 'en-US', timezone: 'America/Los_Angeles', country: 'us' },
  'UK-LND': { locale: 'en-GB', timezone: 'Europe/London', country: 'uk' },
  'DE-BER': { locale: 'de-DE', timezone: 'Europe/Berlin', country: 'de' },
  'FR-PAR': { locale: 'fr-FR', timezone: 'Europe/Paris', country: 'fr' },
  'APAC-SGP': { locale: 'en-SG', timezone: 'Asia/Singapore', country: 'sg' },
  'APAC-TOK': { locale: 'ja-JP', timezone: 'Asia/Tokyo', country: 'jp' },
  'APAC-SYD': { locale: 'en-AU', timezone: 'Australia/Sydney', country: 'au' },
  'US': { locale: 'en-US', timezone: 'America/New_York', country: 'us' },
  'UK': { locale: 'en-GB', timezone: 'Europe/London', country: 'uk' },
  'DE': { locale: 'de-DE', timezone: 'Europe/Berlin', country: 'de' },
  'FR': { locale: 'fr-FR', timezone: 'Europe/Paris', country: 'fr' },
  'SG': { locale: 'en-SG', timezone: 'Asia/Singapore', country: 'sg' }
};

export function normalizeMarket(m) {
  const s = String(m || 'us').trim().toUpperCase().replace(/[_\s]+/g, '-');
  if (/^[A-Z]{2}$/.test(s)) return s;
  if (/^[A-Z]{2,4}-[A-Z]{2,4}$/.test(s)) return s;
  return 'US';
}

export function parseMarket(m) {
  const market = normalizeMarket(m);
  const parts = market.split('-');
  const head = parts[0];
  const known = MARKET_LOCALE[market] || MARKET_LOCALE[head];
  const country = (known?.country || (head.length === 2 ? head : 'US')).toLowerCase();
  return { market, country, metro: parts[1] || null, locale: known };
}

export function resolveMarkets(sysInputs, execGeo) {
  const fromForm = sysInputs?.geo_localization?.markets;
  if (Array.isArray(fromForm) && fromForm.length) return fromForm.map(normalizeMarket);
  const countries = execGeo?.countries?.length ? execGeo.countries : [execGeo?.default_country || 'us'];
  return countries.map(normalizeMarket);
}

/**
 * Proxy resolution order (honest, logged): AEO_PROXY_<MARKET> env (URL or JSON)
 * > execution.playwright.proxy_map[market] > execution.playwright.proxy (default) > null.
 * Env code: US-NY -> AEO_PROXY_US_NY. Value: "http://user:pass@host:port" or JSON.
 */
export function resolveProxyForMarket(market, exec, env = process.env) {
  const code = normalizeMarket(market).replace(/-/g, '_');
  const envVal = env?.[`AEO_PROXY_${code}`];
  if (envVal) {
    try {
      if (envVal.trim().startsWith('{')) {
        const j = JSON.parse(envVal);
        if (j.server) return { proxy: { server: j.server, username: j.username, password: j.password }, source: `env:AEO_PROXY_${code}` };
      } else {
        return { proxy: { server: envVal.trim() }, source: `env:AEO_PROXY_${code}` };
      }
    } catch { /* fall through to proxy_map */ }
  }
  const pm = exec?.playwright?.proxy_map?.[normalizeMarket(market)];
  if (pm?.server) return { proxy: { server: pm.server, username: pm.username, password: pm.password }, source: `proxy_map:${normalizeMarket(market)}` };
  const dflt = exec?.playwright?.proxy;
  if (dflt?.enabled && dflt?.server) {
    return { proxy: { server: dflt.server, username: dflt.username, password: dflt.password }, source: 'playwright.proxy default' };
  }
  return { proxy: null, source: 'none (direct egress — geo retrieval will reflect datacenter IP)' };
}

/**
 * Paired snapshot A/B: duplicate sessions tagged baseline/current when the form
 * requests paired compare with two exact snapshot IDs. Otherwise tag 'current'.
 */
export function pairSnapshots(sessions, temporal) {
  const mode = temporal?.compare_mode;
  const a = (temporal?.baseline_model_snapshot || '').trim();
  const b = (temporal?.current_model_snapshot || '').trim();
  if (mode !== 'paired' || !a || !b) {
    return sessions.map((s) => ({ ...s, snapshot: 'current', snapshotModel: null }));
  }
  const out = [];
  for (const s of sessions) {
    out.push({ ...s, snapshot: 'baseline', snapshotModel: a });
    out.push({ ...s, snapshot: 'current', snapshotModel: b });
  }
  return out;
}

const SNAPSHOT_PROVIDER_HINTS = [
  ['openai', ['gpt', 'openai', 'o1', 'o3']],
  ['anthropic', ['claude', 'anthropic']],
  ['google', ['gemini', 'google']],
  ['perplexity', ['sonar', 'perplexity']],
  ['xai', ['grok', 'xai']],
  ['deepseek', ['deepseek']]
];

/** Resolve a user-supplied snapshot model ID to an initialized provider (family fallback). */
export function resolveProviderForSnapshot(snapshotId, providers) {
  const low = String(snapshotId || '').toLowerCase();
  for (const [name, hints] of SNAPSHOT_PROVIDER_HINTS) {
    if (providers[name] && hints.some((h) => low.includes(h))) return name;
  }
  return null;
}

export const PROMPT_SCALES = {
  pilot: { promptCount: 50, description: 'Pilot: 50 sessions, single run, <$50. Validates wiring before spend.' },
  standard: { promptCount: 500, description: 'Standard: 500 sessions. Shard across days if budget-capped.' },
  enterprise: { promptCount: 5000, description: 'Enterprise: 5000 high-intent sessions. REQUIRES sharding (prompt_shard) + budget gate.' }
};

/** Deterministic shard slice so 5000-prompt runs split across N executions. */
export function shardSessions(sessions, shardIndex = 1, shardTotal = 1) {
  const idx = Math.max(1, shardIndex);
  const total = Math.max(1, shardTotal);
  if (total === 1) return sessions;
  return sessions.filter((_, i) => i % total === idx - 1);
}

export function estimateEnterpriseCalls({ sessions, turnsPerSession = 4, models = 1, repeats = 1, twins = 1, snapshots = 1 }) {
  const calls = sessions * turnsPerSession * Math.max(models, 1) * repeats * twins * snapshots;
  return { calls, overFanoutGuard: calls > 2500 };
}
