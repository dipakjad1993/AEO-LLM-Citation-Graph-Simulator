/**
 * AEO Citation Graph Simulator - Response Verifier
 * Enforces data-quality gates on every LLM response and verifies citations
 * against the live web so that output is provably real and checkable.
 *
 * Two layers:
 *   1. Quality gates  - reject/flag empty, refusal, or degenerately short text.
 *   2. Citation check - resolve each cited URL over HTTP, record status,
 *      final (redirected) URL, latency, and credibility against configured
 *      authority sources / brand domains.
 */

const REFUSAL_PATTERNS = [
  /\bas an (ai|language model|assistant)[,.]/i,
  /\bi('| a)?m (just )?an (ai|language model)/i,
  /\bi can'?t (answer|help|provide)/i,
  /\bi cannot (answer|help|provide)/i,
  /\bi don'?t have access to (real-?time|live|current)/i,
  /\bas of my (last|knowledge) (cutoff|update)/i,
  /\bi '?m not able to/i,
  /\bi '?m sorry,? (but )?i/i,
  /\bsorry,? (but )?i (can'?t|cannot)/i,
  /\bunable to (answer|provide|assist)/i
];

const MIN_RESPONSE_LENGTH = 40;

export function normalizeUrl(url) {
  const cleaned = String(url || '').trim().replace(/[.,;:!?]+$/, '');
  try {
    const parsed = new URL(cleaned);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractDomain(url) {
  try {
    let host = new URL(url).hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return null;
  }
}

export function checkQuality(rawText, { prompt, minLength = MIN_RESPONSE_LENGTH } = {}) {
  const text = String(rawText || '').trim();
  const checks = {};

  checks.non_empty = text.length > 0;
  checks.min_length = text.length >= minLength;
  checks.has_refusal = REFUSAL_PATTERNS.some(re => re.test(text));
  checks.answers_prompt = !prompt || prompt.trim().length === 0
    ? true
    : (() => {
        // A response that does not share a single content word with the prompt
        // is likely off-topic/boilerplate. Stopwords excluded.
        const stopwords = new Set(['a','an','the','and','or','of','for','to','in','on','with','is','are','what','how','which','vs','vs.','best','your','for']);
        const promptWords = new Set(String(prompt).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
        const textWords = new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
        let overlap = 0;
        for (const w of promptWords) {
          if (!stopwords.has(w) && textWords.has(w)) overlap++;
        }
        const meaningfulPromptWords = [...promptWords].filter(w => !stopwords.has(w));
        return meaningfulPromptWords.length === 0 || overlap > 0;
      })();

  const passed = checks.non_empty && checks.min_length && !checks.has_refusal && checks.answers_prompt;
  return { passed, checks, text_length: text.length };
}

export function assessCredibility(url, entityConfig) {
  const domain = extractDomain(url);
  if (!domain) return { score: 0, label: 'invalid', reasons: [] };
  const reasons = [];
  let score = 0.5;

  const authoritySources = entityConfig?.entity_maps?.external_authority_sources || [];
  const authorityDomains = new Set(authoritySources.map(s => String(s.domain).replace(/^www\./, '').toLowerCase()));
  if (authorityDomains.has(domain)) {
    score = 1.0;
    reasons.push('configured_authority_source');
  }

  const brandDomains = [];
  const yourWebsite = entityConfig?.entity_maps?.your_brand?.website;
  if (yourWebsite) brandDomains.push(extractDomain(yourWebsite));
  for (const comp of entityConfig?.entity_maps?.competitors || []) {
    if (comp.website) brandDomains.push(extractDomain(comp.website));
  }
  const brandDomainSet = new Set(brandDomains.filter(Boolean));
  if (brandDomainSet.has(domain)) {
    score = Math.min(1.0, score + 0.2);
    reasons.push('brand_owned_domain');
  }

  return { score, label: score >= 0.8 ? 'credible' : score >= 0.5 ? 'neutral' : 'low', reasons };
}

async function checkUrlOnline(url, { timeoutMs = 15000, maxRedirects = 5 } = {}) {
  const result = { url, status: null, final_url: url, redirect_chain: [], verified: false, error: null, latency_ms: null, content_type: null };
  const start = Date.now();
  let current = url;
  let currentRedirects = 0;

  try {
    while (currentRedirects <= maxRedirects) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (AEO-Verifier/2.0; +verification-bot)',
            'Accept': 'text/html,application/json,text/plain,*/*'
          }
        });
      } finally {
        clearTimeout(timer);
      }
      result.status = response.status;
      result.latency_ms = Date.now() - start;

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) break;
        result.redirect_chain.push(location);
        current = new URL(location, current).toString();
        currentRedirects++;
        continue;
      }

      result.final_url = current;
      result.content_type = response.headers.get('content-type');
      // P0 FIX: 404/410/451 are NOT verified — the cited page does not exist (or is
      // censored). Only 2xx-3xx final URLs count. Old code counted 404 as verified.
      result.verified = response.status >= 200 && response.status <= 399;
      if (!result.verified) result.error = `HTTP ${response.status}`;
      break;
    }
    if (currentRedirects > maxRedirects) {
      result.error = 'too_many_redirects';
    }
  } catch (err) {
    result.error = err.name === 'AbortError' ? 'timeout' : (err.message || 'network_error');
  }

  return result;
}

export class ResponseVerifier {
  constructor(config, { online = true, concurrency = 8 } = {}) {
    this.config = config;
    this.online = online;
    this.concurrency = concurrency;
    this.pending = [];
    this.results = [];
  }

  qualityGate(extracted, { prompt } = {}) {
    const quality = checkQuality(extracted.raw_text, { prompt });
    return {
      ...quality,
      enforced: quality.passed || !this.config?.execution?.verification?.reject_failed_quality
    };
  }

  assessCitationsCredibility(extracted, entityConfig) {
    return (extracted.citations || []).map(c => {
      const normalized = normalizeUrl(c.url);
      if (!normalized) {
        return { ...c, verified: false, verification_detail: { status: 'invalid_url', credibility: { score: 0, label: 'invalid' } } };
      }
      return {
        ...c,
        url: normalized,
        verification_detail: { credibility: assessCredibility(normalized, entityConfig) }
      };
    });
  }

  async verifyCitations(citations) {
    const normalized = (citations || [])
      .map(c => ({ ...c, normalized: normalizeUrl(c.url) }))
      .filter(c => c.normalized);

    const verified = [];
    const slots = Math.min(this.concurrency, Math.max(1, normalized.length));
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < normalized.length) {
        const idx = nextIndex++;
        const citation = normalized[idx];
        const online = await checkUrlOnline(citation.normalized);
        verified.push({ ...citation, ...online });
      }
    }

    const workers = Array.from({ length: slots }, () => worker());
    await Promise.all(workers);
    return verified;
  }

  async run(results) {
    const entityConfig = this.config.entityMaps || {};

    for (const item of results) {
      const extracted = item.result;
      if (!extracted || !extracted.raw_text) continue;

      const quality = this.qualityGate(extracted, { prompt: item.turn?.prompt });
      const citationCandidates = this.assessCitationsCredibility(extracted, entityConfig);
      this.pending.push({ item, quality, citationCandidates });
    }

    if (this.online) {
      const allCitations = this.pending.flatMap(p => p.citationCandidates.map(c => c.normalized ? c.normalized : null).filter(Boolean));
      const onlineChecks = await this.verifyCitations(allCitations);
      const byUrl = new Map(onlineChecks.map(c => [c.normalized, c]));

      for (const p of this.pending) {
        p.onlineChecks = p.citationCandidates.map(c => {
          if (!c.normalized) {
            return { ...c, verified: false, verification_detail: { ...c.verification_detail, http: { status: 'invalid_url' } } };
          }
          const check = byUrl.get(c.normalized) || {};
          return { ...c, ...check, verification_detail: { ...c.verification_detail, http: { status: check.status, final_url: check.final_url, latency_ms: check.latency_ms, error: check.error } } };
        });
      }
    } else {
      for (const p of this.pending) {
        p.onlineChecks = p.citationCandidates.map(c => ({
          ...c,
          verification_detail: { ...c.verification_detail, http: { status: 'offline_check_skipped' } }
        }));
      }
    }

    for (const p of this.pending) {
      const verifiedCount = p.onlineChecks.filter(c => c.verified === true).length;
      const total = p.onlineChecks.length;
      p.item.result.verification = {
        quality: p.quality,
        citations: {
          total,
          verified: verifiedCount,
          unverified: total - verifiedCount,
          checked: this.online
        },
        // P0 FIX: fail CLOSED when require_verified_citations=true AND online checks ran:
        // zero citations can no longer pass vacuously (old: total===0 -> passed) and every
        // cited URL must return 2xx-3xx. Offline/skipped checks can never satisfy the gate
        // (fail closed: required-but-unchecked = fail). Default path (require=false)
        // preserves legacy semantics so offline runs keep working.
        passed: p.quality.enforced && (
          this.config?.execution?.verification?.require_verified_citations
            ? (this.online && total > 0 && verifiedCount === total)
            : (total === 0 || verifiedCount > 0 || !this.config?.execution?.verification?.require_verified_citations)
        )
      };
      p.item.result.citations = p.onlineChecks.map(c => ({
        url: c.url,
        title: c.title,
        citationId: c.citationId,
        type: c.type,
        source: c.source,
        confidence: c.confidence,
        verified: c.verified === true,
        verification_detail: c.verification_detail
      }));
    }

    this.results = this.pending.map(p => ({
      executionId: p.item.executionId,
      quality: p.item.result.verification?.quality,
      verification: p.item.result.verification
    }));
    return results;
  }

  summary() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.verification?.passed).length;
    const citations = this.results.flatMap(r => r.verification?.citations ? [r.verification.citations] : []);
    const totalCitations = citations.reduce((s, c) => s + c.total, 0);
    const verifiedCitations = citations.reduce((s, c) => s + c.verified, 0);
    return {
      responses_checked: total,
      responses_passed: passed,
      responses_failed: total - passed,
      citations_checked: totalCitations,
      citations_verified: verifiedCitations,
      citation_verification_rate: totalCitations ? verifiedCitations / totalCitations : 1,
      online_verification: this.online
    };
  }
}
