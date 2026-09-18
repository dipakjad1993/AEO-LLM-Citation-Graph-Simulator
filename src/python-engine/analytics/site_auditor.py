"""
Site Auditor — technical SEO truth for AI surfacing (2026).
Google AI Optimization Guide (May 2026): AIO/AI Mode need indexed +
snippet-eligible pages (core ranking + RAG + fan-out). No special markup,
no llms.txt, no chunking required for Google — but ChatGPT/Claude/Perplexity
still reward FAQ/Product schema + static HTML.

Checks (all computed from live fetches of the brand site, zero fabrication):
  static_vs_js      — 94% static parse success vs ~23% JS-required (fetch + render-signal heuristics)
  snippet_eligibility — nosnippet / max-snippet:0 / data-nosnippet grep (apply to AI features too)
  semantic_html     — answer-first 20-40w blocks under question H2s, tables/lists, quotable 40-60w definitions
  jsonld_valid      — Org @id/sameAs, Product/Offer/GTIN, FAQ 40-60w, Article author/dateModified, LocalBusiness/GBP match
  freshness         — dateModified presence + age (ChatGPT/Perplexity ~30d, Claude quarter, AIO year)
  e_e_a_t           — author bylines, about/contact, Merchant Center/GBP signals for commerce/local
"""
import json
import logging
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from functools import lru_cache
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse, urljoin

logger = logging.getLogger(__name__)

SITE_AUDIT_UA = 'Mozilla/5.0 (compatible; AEO-Simulator/2.0; +site-audit)'


@lru_cache(maxsize=64)
def _fetch_cached(url: str, timeout: int = 12) -> str:
    import json as _j
    fetched = _fetch(url, timeout=timeout)
    return _j.dumps(fetched, default=str)


def _fetch(url: str, timeout: int = 12) -> Optional[Dict[str, Any]]:
    import json as _j
    try:
        req = urllib.request.Request(url, headers={'User-Agent': SITE_AUDIT_UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(1000000)
            try:
                body = raw.decode('utf-8')
            except UnicodeDecodeError:
                body = raw.decode('utf-8', 'ignore')
            return {'html': body, 'status': resp.status, 'headers': dict(resp.headers)}
    except Exception as e:
        return {'error': str(e)}


def _fetch_many(urls, timeout=12, workers=4):
    import json as _j
    out = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_fetch_cached, u, timeout): u for u in urls}
        for f, u in futs.items():
            try:
                out[u] = _j.loads(f.result())
            except Exception as e:
                out[u] = {'error': str(e)}
    return out


def _strip_tags(html: str) -> str:
    text = re.sub(r'<script.*?</script>', ' ', html, flags=re.S | re.I)
    text = re.sub(r'<style.*?</style>', ' ', text, flags=re.S | re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


class SiteAuditor:
    def __init__(self, config: Dict):
        self.config = config
        em = config.get('entity_maps', {}).get('entity_maps', {})
        self.brand = em.get('your_brand', {}) or {}
        self.website = (self.brand.get('website') or '').rstrip('/')
        self.audit_cfg = config.get('analytics', {}).get('site_audit', {}) or {}

    def audit(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            'website': self.website, 'checks': {}, 'score': 0, 'findings': [], 'fixes': [],
        }
        if not self.website:
            result['status'] = 'no_website'
            result['message'] = 'Set your_brand.website in entity_maps.json to enable the technical site audit.'
            return result
        pages = [self.website] + [urljoin(self.website + '/', p.lstrip('/')) for p in self.audit_cfg.get('extra_pages', [])[:5]]
        import json as _j
        prefetched = _fetch_many(pages, workers=self.audit_cfg.get('fetch_workers', 4))
        page_results = [self.audit_page(u, prefetched=u and prefetched.get(u)) for u in pages]
        result['pages'] = page_results
        ok = [p for p in page_results if not p.get('error')]
        if not ok:
            result['status'] = 'fetch_failed'
            result['message'] = f'Could not fetch {self.website}: {page_results[0].get("error")}'
            return result
        # Aggregate score (0-100)
        weights = {'snippet_eligibility': 25, 'js_render': 20, 'semantic_html': 20, 'jsonld': 20, 'freshness': 10, 'eeat': 5}
        total = 0
        for key, w in weights.items():
            vals = [p['checks'].get(key, {}).get('score', 0) for p in ok]
            avg = sum(vals) / len(vals) if vals else 0
            result['checks'][key] = {'score': round(avg, 1), 'weight': w}
            total += avg * w / 100
        result['score'] = round(total, 1)
        result['grade'] = 'A' if total >= 85 else 'B' if total >= 70 else 'C' if total >= 50 else 'F'
        for p in ok:
            result['findings'].extend(p.get('findings', []))
            result['fixes'].extend(p.get('fixes', []))
        result['status'] = 'audited'
        # P0 FAIL GATE (Google May-15 Guide): snippet blocks kill ALL AIO visibility.
        blocked_pages = [p['url'] for p in ok if p.get('checks', {}).get('snippet_eligibility', {}).get('score', 100) == 0]
        result['fail_gate'] = {
            'snippet_blocked': bool(blocked_pages),
            'blocked_pages': blocked_pages,
            'ci_exit_code': 2 if blocked_pages else 0,
            'case_study': 'Meltwater May-2026 relaunch fixing snippet blocks drove 99k -> 172k citations (+73% in weeks).',
            'action': 'Remove nosnippet/max-snippet:0/data-nosnippet from answer blocks, then re-run snippet_gate.py in CI.' if blocked_pages else 'Snippet-eligible. Keep gate in CI.',
        }
        if blocked_pages:
            result['findings'].append(f"FAIL GATE: {len(blocked_pages)} page(s) snippet-blocked — AIO visibility is 0 until fixed.")
            self._fire_slack(f"⛔ AEO snippet FAIL GATE: {', '.join(blocked_pages[:5])} blocked (nosnippet/max-snippet:0/data-nosnippet). AIO visibility = 0. Meltwater +73% precedent — fix now.")
        return result

    def audit_page(self, url: str, prefetched: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        out: Dict[str, Any] = {'url': url, 'checks': {}, 'findings': [], 'fixes': []}
        fetched = prefetched if prefetched is not None else _fetch(url)
        if not fetched or 'error' in fetched:
            out['error'] = (fetched or {}).get('error', 'fetch failed')
            return out
        html = fetched.get('html', '')
        text = _strip_tags(html)
        out['status_code'] = fetched.get('status')
        out['word_count'] = len(text.split())

        # 1. JS-render risk: app-root shells with near-empty static text
        shell_signals = len(re.findall(r'<div id="(root|app|__next)"[^>]*>\s*(</div>|<!--)', html, re.I))
        next_data = '__NEXT_DATA__' in html or 'nuxt' in html.lower()
        static_words = len(text.split())
        js_required = static_words < 150 and (shell_signals > 0 or next_data)
        out['checks']['js_render'] = {
            'score': 40 if js_required else 100,
            'static_word_count': static_words,
            'js_required_likely': js_required,
            'detail': ('Likely JS-rendered shell (<150 static words). LLM crawlers parse static HTML at ~94% vs ~23% for JS — server-render key content.' if js_required
                       else f'Static HTML parse OK ({static_words} words).'),
        }
        if js_required:
            out['findings'].append(f'{url}: JS-rendered shell — crawlers may see an empty page.')
            out['fixes'].append('Server-side render (or pre-render) answer-first blocks; verify with curl — what curl returns is what most LLM crawlers get.')

        # 2. Snippet eligibility
        snippet_blocks = []
        if re.search(r'<meta[^>]+name=["\']robots["\'][^>]*nosnippet', html, re.I): snippet_blocks.append('meta robots nosnippet')
        if re.search(r'max-snippet\s*:\s*0', html, re.I): snippet_blocks.append('max-snippet:0')
        if 'data-nosnippet' in html: snippet_blocks.append('data-nosnippet attribute')
        out['checks']['snippet_eligibility'] = {
            'score': 0 if snippet_blocks else 100,
            'blocks': snippet_blocks,
            'detail': ('BLOCKED: ' + ', '.join(snippet_blocks) + ' — Google applies these to AI Overviews/Mode too. Remove to become snippet-eligible.' if snippet_blocks
                       else 'Snippet-eligible: no nosnippet/max-snippet:0/data-nosnippet found.'),
        }
        if snippet_blocks:
            out['findings'].append(f'{url}: snippet-blocked ({", ".join(snippet_blocks)}).')
            out['fixes'].append('Remove nosnippet/max-snippet:0/data-nosnippet from answer blocks — snippet eligibility is the entry ticket for AIO.')

        # 3. Semantic HTML: question H2s, answer-first blocks, tables/lists, quotable definitions
        h2s = re.findall(r'<h2[^>]*>(.*?)</h2>', html, re.S | re.I)
        question_h2 = [h for h in h2s if '?' in _strip_tags(h)]
        lists = len(re.findall(r'<(ul|ol|table)[\s>]', html, re.I))
        paras = [p for p in re.findall(r'<p[^>]*>(.*?)</p>', html, re.S | re.I)]
        answer_first = 0
        for h in h2s[:10]:
            idx = html.find(h)
            following = _strip_tags(html[idx:idx + 3000]).split()[:40]
            if len(following) >= 20:
                answer_first += 1
        quotable = sum(1 for p in paras if 40 <= len(_strip_tags(p).split()) <= 60)
        sem_score = min(100, (25 if question_h2 else 0) + (25 if answer_first >= 2 else answer_first * 12) + (25 if lists >= 2 else lists * 12) + (25 if quotable >= 1 else 0))
        out['checks']['semantic_html'] = {
            'score': sem_score, 'question_h2_count': len(question_h2), 'answer_first_blocks': answer_first,
            'tables_lists': lists, 'quotable_40_60w_blocks': quotable,
            'detail': f'{len(question_h2)} question-H2s, {answer_first} answer-first blocks, {lists} tables/lists, {quotable} quotable 40-60w definitions.',
        }
        if sem_score < 70:
            out['fixes'].append('Add question-H2s with 20-40 word direct answers in the first 2 lines, semantic tables/lists, and 40-60w quotable definitions.')

        # 4. JSON-LD validation
        jsonlds = []
        for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S | re.I):
            try:
                data = json.loads(m.group(1))
                jsonlds.extend(data if isinstance(data, list) else [data])
            except Exception:
                out['findings'].append(f'{url}: unparseable JSON-LD block (invalid JSON).')
        types = [j.get('@type') for j in jsonlds if isinstance(j, dict)]
        checks = {
            'has_org': any(t in ('Organization', 'Corporation') for t in (types if isinstance(types, list) else [])),
            'org_id_sameAs': any(isinstance(j, dict) and j.get('@id') and j.get('sameAs') for j in jsonlds),
            'has_faq': 'FAQPage' in types,
            'has_product_offer': 'Product' in types,
            'has_article_meta': any(isinstance(j, dict) and j.get('@type') == 'Article' and j.get('author') and (j.get('dateModified') or j.get('datePublished')) for j in jsonlds),
            'has_local': any(t in ('LocalBusiness', 'Store', 'Service') for t in (types if isinstance(types, list) else [])),
        }
        jsonld_score = round(sum(checks.values()) / max(len(checks), 1) * 100, 1)
        out['checks']['jsonld'] = {'score': jsonld_score, 'types': types, 'checks': checks,
            'detail': f"JSON-LD types: {types or ['none']}. FAQ 40-60w answers + Org @id/sameAs + Product/Offer/GTIN + Article author/dateModified."}
        if jsonld_score < 70:
            out['fixes'].append('Emit valid JSON-LD: Organization with @id+sameAs, FAQPage (40-60w answers), Product/Offer (+GTIN), Article with author+dateModified, LocalBusiness matching GBP.')

        # 5. Freshness / dateModified
        dates = re.findall(r'"dateModified"\s*:\s*"([^"]+)"', html) + re.findall(r'<time[^>]+datetime="([^"]+)"', html)
        age_days = None
        if dates:
            try:
                dt = datetime.fromisoformat(dates[0].replace('Z', '+00:00'))
                age_days = (datetime.now(timezone.utc) - dt).days
            except Exception:
                pass
        fresh_score = 100 if age_days is not None and age_days <= 90 else 60 if age_days is not None and age_days <= 365 else 20
        out['checks']['freshness'] = {'score': fresh_score, 'dateModified': dates[0] if dates else None, 'age_days': age_days,
            'detail': 'Freshness windows: ChatGPT/Perplexity ~30d, Claude ~quarter, AIO ~year. Keep money pages <90d.' if dates else 'No dateModified found — add it (freshness is a rerank signal).'}
        if not dates:
            out['fixes'].append('Add visible + machine-readable dateModified and refresh money pages on a cadence (see geo_temporal.refresh_cadence).')

        # 6. E-E-A-T surface signals
        author = bool(re.search(r'(rel="author"|class="[^"]*author|by\s+[A-Z][a-z]+\s+[A-Z][a-z]+)', html))
        about = bool(re.search(r'href="[^"]*(about|contact|team)', html, re.I))
        eeat_score = (50 if author else 0) + (50 if about else 0)
        out['checks']['eeat'] = {'score': eeat_score, 'author_byline': author, 'about_contact': about,
            'detail': 'Author bylines + About/Contact + original data + Merchant Center/GBP for commerce/local.'}
        if eeat_score < 100:
            out['fixes'].append('Add author bylines with bios, About/Contact pages, original data/methodology, Merchant Center + GBP for commerce/local.')

        # 7. NEGATIVE checks (Google May-15 + Aug-31 2026: GEO Twitter myths that HURT).
        # These do not raise the score — they flag hacks to REMOVE.
        neg = []
        words = text.split()
        # keyword stuffing: top content word density > 4%
        from collections import Counter as _C
        toks = [w.lower() for w in re.findall(r"[a-z]{4,}", text.lower())]
        if toks:
            top, cnt = _C(toks).most_common(1)[0]
            dens = cnt / max(len(toks), 1)
            if dens > 0.04 and len(toks) > 200:
                neg.append(f"keyword-stuffing: '{top}' density {dens:.1%} — remove stuffing; write for the task, not density.")
        # chunking hack: dozens of near-identical short H2/H3 blocks
        h_all = re.findall(r'<h[23][^>]*>(.*?)</h[23]>', html, re.S | re.I)
        if len(h_all) >= 12 and len(set(_strip_tags(h).strip().lower()[:40] for h in h_all)) < len(h_all) * 0.6:
            neg.append("chunking-hack: many near-duplicate H2/H3 blocks — Google says chunking is NOT required; consolidate into task-complete sections.")
        # separate near-duplicate AI page
        if re.search(r"/ai-|/llm-|/chatgpt-|ai-overview", url, re.I) and len(words) < 600:
            neg.append("separate-thin-AI-page: thin /ai-* page risks near-duplicate — consolidate into the canonical page unless it serves a distinct task.")
        # llms.txt overweight guard
        if re.search(r"llms\.txt.*(30%|weight.*30|priority.*high)", body, re.I):
            neg.append("llms.txt-overweight: llms.txt scores 0 — NOT a Google ranking factor (Google Dec-2025 + May-15-2026 Guide, Illyes/Mueller). Infra-only probe for coding agents. Ship MCP/UCP/ACP first.")
        out['checks']['negative_geo_myths'] = {'score': 100 if not neg else 40, 'flags': neg,
            'detail': 'Google-killed tactics: chunking, keyword density/long-tail stuffing, separate AI pages, llms.txt overweight, AI-rewrite.' if neg else 'No GEO-myth hacks detected.'}
        for n in neg:
            out['findings'].append(f'{url}: {n}')
            out['fixes'].append(f'REMOVE: {n}')
        return out

    def save(self, results: Dict, output_dir) -> None:
        reports = output_dir / 'reports'
        reports.mkdir(exist_ok=True)
        with open(reports / 'site_audit.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
        logger.info('Saved site audit to %s', reports)

    @staticmethod
    def _fire_slack(text: str) -> None:
        import os
        hook = os.environ.get('SLACK_WEBHOOK_URL', '')
        if not hook:
            return
        try:
            import urllib.request as _u
            req = _u.Request(hook, data=json.dumps({'text': text}).encode('utf-8'), headers={'Content-Type': 'application/json'})
            _u.urlopen(req, timeout=10)
            logger.info('Snippet fail-gate Slack alert fired.')
        except Exception as e:
            logger.warning(f'Slack webhook failed: {e}')
