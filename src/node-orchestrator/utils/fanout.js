/**
 * Query fan-out harness (Peec 0.0019% -> 99.9% pattern, emulated locally).
 *
 * Real AI engines decompose one user question into N subqueries (fan-out),
 * retrieve passages per subquery, then RERANK before answering. This module
 * emulates that pipeline on OUR side for two honest purposes:
 *
 *  1. fanoutSubqueries(prompt) — rule-based decomposition so we can log what
 *     sub-questions an engine likely issued (join with provider-reported
 *     hidden_search_queries / fanout_queries when available; ours are always
 *     labeled origin:'local_decomposition', never passed off as engine telemetry).
 *  2. rerankPassages(query, passages) — BM25-lite + position prior scorer so
 *     site-audit / remediation can say WHICH passage would win the rerank.
 *
 * No extra API calls. No fabrication: local rows are tagged as local.
 */

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'is',
  'are', 'was', 'were', 'what', 'how', 'which', 'vs', 'vs.', 'your', 'my',
  'it', 'this', 'that', 'do', 'does', 'i', 'we', 'you', 'best', 'top',
]);

function tokens(s) {
  return String(s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
}

function keywords(s) {
  return tokens(s).filter((t) => !STOP.has(t));
}

/**
 * Decompose a money prompt into likely engine subqueries.
 * Rules: split comparisons (X vs Y), split conjunctions, extract price /
 * feature / review facets. Deterministic, capped at 6.
 */
export function fanoutSubqueries(prompt, { maxSub = 6 } = {}) {
  const p = String(prompt || '').trim();
  if (!p) return [];
  const subs = [];
  const push = (q, facet) => {
    const qq = q.trim().replace(/\s+/g, ' ');
    if (qq.length > 12 && !subs.some((s) => s.query === qq)) subs.push({ query: qq, facet, origin: 'local_decomposition' });
  };

  // 1. Comparison split: "X vs Y ..." -> ["X ...", "Y ...", "X vs Y reviews"]
  const vs = p.split(/\s+vs\.?\s+/i);
  if (vs.length === 2) {
    const tail = vs[1].split('?')[0];
    push(`${vs[0]} features pricing`, 'entity_a');
    push(`${tail} features pricing`, 'entity_b');
    push(`${vs[0]} vs ${tail} comparison reviews`, 'comparison');
  }
  // 2. Conjunction split on ' and ' / commas with verbs
  for (const part of p.split(/\s+and\s+|;\s*/)) {
    if (part.length > 20 && subs.length < maxSub) push(`${part.trim()}`, 'facet');
  }
  // 3. Money facets engines always add
  const kws = keywords(p).slice(0, 4).join(' ');
  if (kws) {
    if (/pric|cost|plan/i.test(p)) push(`${kws} pricing plans cost`, 'pricing');
    if (/secur|soc|gdpr|compliance/i.test(p)) push(`${kws} security compliance certifications`, 'compliance');
    if (/review|rating|best/i.test(p)) push(`${kws} reviews ratings reddit`, 'reviews');
    push(`${kws} official documentation`, 'official');
  }
  if (!subs.length) push(p.slice(0, 200), 'whole');
  return subs.slice(0, maxSub);
}

/**
 * Rerank candidate passages for a query. Score = 0.6*BM25-lite + 0.25*position
 * prior (earlier = better) + 0.15*exact-phrase bonus. Returns sorted rows with
 * {text, score, rank}. Used to say which owned passage would survive a rerank.
 */
export function rerankPassages(query, passages) {
  const qTerms = keywords(query);
  const qSet = new Set(qTerms);
  const docs = (passages || []).map((t, i) => ({ text: String(t || ''), terms: keywords(t), idx: i }));
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.terms)) df.set(t, (df.get(t) || 0) + 1);
  const N = Math.max(docs.length, 1);
  const scored = docs.map((d) => {
    const tf = new Map();
    for (const t of d.terms) tf.set(t, (tf.get(t) || 0) + 1);
    let bm = 0;
    for (const q of qSet) {
      const f = tf.get(q) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(q) || 0) + 0.5) / ((df.get(q) || 0) + 0.5));
      bm += idf * ((f * 2.2) / (f + 1.2));
    }
    const normBm = bm / Math.max(qSet.size, 1);
    const posPrior = 1 / (1 + d.idx * 0.15);
    const phraseBonus = qTerms.length > 1 && d.text.toLowerCase().includes([...qSet].slice(0, 3).join(' ')) ? 1 : 0;
    const score = 0.6 * normBm + 0.25 * posPrior + 0.15 * phraseBonus;
    return { text: d.text, score: Math.round(score * 10000) / 10000, source_index: d.idx };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}
