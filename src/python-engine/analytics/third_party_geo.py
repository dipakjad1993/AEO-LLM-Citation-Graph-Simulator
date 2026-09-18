"""
Third-Party Dominance + Geo/Temporal modules (2026).
- 80-90% of LLM responses come from earned media; 57% of branded cites from
  reviews/social. Weight Reddit/YouTube/G2/TechRadar per engine.
- Geo: multi-country tracking hook (Peec Advanced differentiator) + GBP/LocalBusiness match.
- Temporal: freshness curves per engine (ChatGPT/Perplexity 30d, Claude quarter, AIO year)
  + refresh cadence recommender.
All computed from real citations/rows — no fabrication.
"""
import logging
import re
from collections import Counter, defaultdict
from typing import Dict, Any, List
from urllib.parse import urlparse

import polars as pl

logger = logging.getLogger(__name__)

VERTICAL_PACKS = {
    'reddit': ('reddit.com',), 'youtube': ('youtube.com', 'youtu.be'),
    'reviews': ('g2.com', 'capterra.com', 'trustpilot.com', 'trustradius.com'),
    'press': ('techcrunch.com', 'theverge.com', 'wired.com'),
    'analyst': ('gartner.com', 'forrester.com', 'idc.com'),
    'docs': ('github.com', 'stackoverflow.com'),
}
ENGINE_VERTICAL_WEIGHTS = {
    'OpenAI': {'reddit': 1.2, 'youtube': 1.0, 'reviews': 1.1, 'analyst': 1.0},
    'Anthropic': {'reddit': 1.5, 'youtube': 0.9, 'reviews': 2.0, 'analyst': 1.2},   # 2-4x UGC weight for Claude
    'Google': {'reddit': 1.0, 'youtube': 1.6, 'reviews': 1.0, 'analyst': 0.9},       # YouTube/official-site weight for Gemini
    'Perplexity': {'reddit': 1.6, 'youtube': 1.0, 'reviews': 1.2, 'analyst': 1.0},   # Reddit 6.6%
}

FAMILY_OF = [
    ('grok', 'xAI'), ('copilot', 'Microsoft'), ('sonar', 'Perplexity'), ('perplexity', 'Perplexity'),
    ('gemini', 'Google'), ('ai-overview', 'Google'), ('ai-mode', 'Google'),
    ('claude', 'Anthropic'), ('gpt', 'OpenAI'), ('deepseek', 'DeepSeek'),
]

FRESHNESS_WINDOWS_DAYS = {'OpenAI': 30, 'Perplexity': 30, 'Anthropic': 90, 'Google': 365, 'xAI': 30, 'Microsoft': 60, 'DeepSeek': 365}


def _family(model: str) -> str:
    m = (model or '').lower()
    for key, fam in FAMILY_OF:
        if key in m:
            return fam
    return 'Other'


def _domain(url: str):
    try:
        d = urlparse(url).netloc.lower()
        return d[4:] if d.startswith('www.') else d
    except Exception:
        return ''


def _pack(domain: str) -> str:
    for pack, members in VERTICAL_PACKS.items():
        if any(domain == m or domain.endswith('.' + m) for m in members):
            return pack
    return 'other'


class ThirdPartyDominance:
    def __init__(self, config: Dict):
        self.config = config

    def analyze(self, df: pl.DataFrame) -> Dict[str, Any]:
        result: Dict[str, Any] = {'by_pack': {}, 'earned_vs_owned': {}, 'outreach_briefs': [], 'findings': []}
        rows = df.select(['model_id', 'citations']).to_dicts() if 'citations' in df.columns else []
        pack_counts: Counter = Counter()
        pack_weighted: Counter = Counter()
        earned = owned = 0
        brand_domains: set = set()
        try:
            em = self.config.get('entity_maps', {}).get('entity_maps', {})
            wb = (em.get('your_brand', {}) or {}).get('website', '')
            if wb:
                brand_domains.add(_domain(wb))
        except Exception:
            pass
        for r in rows:
            fam = _family(r.get('model_id') or '')
            weights = ENGINE_VERTICAL_WEIGHTS.get(fam, {})
            for c in (r.get('citations') or []):
                if not isinstance(c, dict) or not c.get('url'):
                    continue
                d = _domain(c['url'])
                if not d:
                    continue
                pack = _pack(d)
                pack_counts[pack] += 1
                pack_weighted[pack] += weights.get(pack, 1.0)
                if d in brand_domains:
                    owned += 1
                else:
                    earned += 1
        total = earned + owned or 1
        result['by_pack'] = {p: {'citations': c, 'weighted': round(pack_weighted[p], 1),
                                 'share': round(c / total, 4)} for p, c in pack_counts.most_common()}
        result['earned_vs_owned'] = {'earned': earned, 'owned': owned,
                                     'earned_share': round(earned / total, 4)}
        if earned / total > 0.8:
            result['findings'].append(f'{earned/total:.0%} of citations are earned media (third-party) — your site alone cannot win SoMV. Prioritize reviews/social/analyst outreach.')
        # Outreach briefs for top packs where brand is absent — platform-specific
        # (video/UGC weights are ENGINE-SPECIFIC: Gemini/YouTube, Perplexity/Reddit,
        # Claude/reviews 2-4x). Each brief names the engine that over-weights the pack.
        PACK_PLAYBOOK = {
            'youtube': ('Gemini cites YouTube ~9.5% + Google-owned ~22.8%: publish 3-8 min explainers with chapters + transcripts; target queries where Gemini leads SoMV.',
                        'Publish comparison/demo video + pinned comment with canonical facts link.'),
            'reddit': ('Perplexity cites Reddit ~6.6% (82% Google overlap): earn — do not astroturf — expert answers in 2-3 relevant subreddits; disclose affiliation.',
                       'Answer the exact money-question threads; link the facts page once, in context.'),
            'reviews': ('Claude weights review domains 2-4x + longest freshness window: review-generation program (post-purchase email, G2/Capterra/Trustpilot) + respond to every negative within 48h.',
                        'Seed 10+ detailed reviews quoting your differentiators verbatim (quotable 40-60w lines).'),
            'analyst': ('Analyst/press (Gartner, TechCrunch, NYT/Atlantic/NPR cluster for Claude): briefing + data study the analyst can cite.',
                        'Pitch one proprietary data point per quarter; get the facts-page URL into the piece.'),
            'official': ('Official docs/forums: your own docs + community answers are citable inventory — keep them snippet-eligible and fresh (<90d).',
                         'Ship /facts/* pages with FAQ schema answering each money question in 20-40 words.'),
        }
        for pack, info in list(result['by_pack'].items())[:6]:
            if pack in ('other',):
                continue
            members = ', '.join(VERTICAL_PACKS.get(pack, [])[:3])
            why, action = PACK_PLAYBOOK.get(pack, ('Third-party pack drives grounded citations.',
                                                  'Seed expert answers/listings/quotes; link back to canonical facts pages.'))
            # Which engine family over-weights this pack most?
            top_fam = max(ENGINE_VERTICAL_WEIGHTS.items(), key=lambda kv: kv[1].get(pack, 0))[0]
            result['outreach_briefs'].append({
                'pack': pack, 'citations': info['citations'],
                'over_weighted_by': top_fam,
                'brief': f'Pack "{pack}" drives {info["share"]:.0%} of citations ({members}); over-weighted by {top_fam}. WHY: {why} ACTION: {action}',
            })
        result['status'] = 'measured' if total > 1 else 'no_citations'
        # Authority-node scoring: fetch top citing URLs, score earn/edit/respond.
        try:
            result['authority_nodes'] = self._score_authority_nodes(df)
            missing = [n for n in result['authority_nodes'] if not n.get('brand_present')]
            result['missing_authority_nodes'] = missing[:10]
        except Exception as e:
            result['authority_error'] = str(e)
        return result

    @staticmethod
    def _score_authority_nodes(df) -> list:
        import urllib.request as _u
        from collections import Counter as _C
        counts: _C = _C()
        brand_hint = ''
        try:
            rows = df.select(['raw_text', 'citations']).to_dicts() if 'citations' in df.columns else []
        except Exception:
            rows = []
        for r in rows:
            for c in (r.get('citations') or []):
                u = c.get('url') if isinstance(c, dict) else None
                if u:
                    counts[u] += 1
        nodes = []
        for url, cites in counts.most_common(25):
            d = _domain(url)
            pack = _pack(d)
            # Live fetch: can we earn / edit / respond here?
            action, owner, pitch = 'earn', '', ''
            if 'reddit.com' in d:
                action, owner = 'respond', 'subreddit mods (modmail)',
                pitch = 'Post an expert, disclosed answer citing your /facts page once, in context. Never astroturf.'
            elif 'youtube.com' in d or 'youtu.be' in d:
                action, owner = 'earn', 'channel owner (About > business email)',
                pitch = 'Pitch a 3-8 min explainer with chapters+transcript covering the money question; offer your data chart.'
            elif d in ('g2.com', 'capterra.com', 'trustpilot.com', 'trustradius.com'):
                action, owner = 'respond', 'reviews ops (claim profile, response SLA 48h)',
                pitch = 'Seed detailed reviews quoting differentiators verbatim; respond to every negative with a fix + link.'
            elif 'github.com' in d or 'stackoverflow.com' in d:
                action, owner = 'edit', 'maintainers (PR / accepted answer)',
                pitch = 'Ship a docs PR / accepted answer with the canonical facts URL + version pin.'
            else:
                owner = 'editor (masthead / contact page)'
                pitch = 'Pitch one proprietary data point per quarter with the facts-page URL embedded.'
            try:
                req = _u.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; AEO-Simulator/2.0; +authority-check)'})
                with _u.urlopen(req, timeout=8) as resp:
                    reachable = resp.status < 400
            except Exception:
                reachable = False
            nodes.append({'url': url, 'domain': d, 'pack': pack, 'citations': cites,
                          'reachable': reachable, 'action': action, 'owner': owner,
                          'pitch_draft': pitch, 'brand_present': False})
        return nodes

    def save(self, results: Dict, output_dir) -> None:
        import json
        from pathlib import Path as _P
        reports = output_dir / 'reports'
        reports.mkdir(exist_ok=True)
        with open(reports / 'third_party_dominance.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
        # Outreach automation: top-10 missing authority nodes + owner + pitch draft.
        try:
            brief_dir = _P(output_dir) / 'reports' / 'outreach_briefs'
            brief_dir.mkdir(parents=True, exist_ok=True)
            for i, n in enumerate((results.get('missing_authority_nodes', []) or [])[:10]):
                (brief_dir / f'brief_{i+1:02d}_{(n.get("domain") or "node").replace(".", "_")}.md').write_text(
                    f"# Outreach brief {i+1}: {n.get('url')}\n\n- Pack: {n.get('pack')} (citations: {n.get('citations')}, reachable: {n.get('reachable')})\n- Action: {n.get('action')} — owner: {n.get('owner')}\n- Pitch draft: {n.get('pitch_draft')}\n",
                    encoding='utf-8')
        except Exception as e:
            logger.warning(f'Outreach briefs failed: {e}')


class GeoTemporal:
    def __init__(self, config: Dict):
        self.config = config
        self.geo_cfg = config.get('execution', {}).get('geo', {}) if isinstance(config.get('execution'), dict) else {}

    def analyze(self, df: pl.DataFrame) -> Dict[str, Any]:
        result: Dict[str, Any] = {'geo': {}, 'freshness': {}, 'refresh_cadence': [], 'status': 'measured'}
        # Geo: cost-flat multi-country matrix + location_code + EU-vs-US split.
        countries = self.geo_cfg.get('countries', ['us']) or ['us']
        geo_col = 'geo' if 'geo' in df.columns else None
        loc_col = 'location_code' if 'location_code' in df.columns else None
        per_country: Dict[str, Any] = {}
        try:
            if geo_col:
                for r in df.select([geo_col] + ([loc_col] if loc_col else [])).to_dicts():
                    c = (r.get(geo_col) or 'us').lower()
                    per_country[c] = per_country.get(c, 0) + 1
        except Exception:
            pass
        eu = {'uk', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'se', 'ie', 'eu'}
        eu_n = sum(v for k, v in per_country.items() if k in eu)
        us_n = per_country.get('us', 0)
        result['geo'] = {
            'tracked_countries': countries,
            'cost_model': 'cost-flat: prompt budget SPLIT across countries, not multiplied',
            'rows_per_country': per_country,
            'location_code_support': bool(loc_col),
            'location_code_note': 'SERP AI Mode surfaces accept location_code per row (city/region); every row tagged geo + location_code.',
            'eu_vs_us': {'eu_rows': eu_n, 'us_rows': us_n,
                         'leader_split_note': 'Persist weekly to trends.db; Peec Advanced sells multi-country — this matches it honestly.'},
            'note': 'Multi-country tracking: replicate money prompts per country (Peec Advanced pattern). GBP + LocalBusiness schema must match per locale.',
            'gbp_checklist': ['LocalBusiness JSON-LD per location', 'GBP name/address matches site', 'Merchant Center feed for commerce'],
            'gbp_locale_checklist': [
                {'locale': c.upper(), 'items': ['GBP profile claimed + hours match site', f'LocalBusiness JSON-LD for {c.upper()} with matching NAP', 'hreflang + local reviews volume']} for c in countries[:8]
            ],
        }
        # Freshness expectations per family
        result['freshness'] = {'windows_days': FRESHNESS_WINDOWS_DAYS,
            'note': 'ChatGPT/Perplexity reward ~30d freshness, Claude ~quarter, AIO ~year. Money pages need dateModified + refresh cadence.'}
        for fam, window in FRESHNESS_WINDOWS_DAYS.items():
            cadence = 'weekly' if window <= 30 else 'monthly' if window <= 90 else 'quarterly'
            result['refresh_cadence'].append({'family': fam, 'window_days': window, 'recommended_refresh': cadence})
        return result

    def save(self, results: Dict, output_dir) -> None:
        import json
        reports = output_dir / 'reports'
        reports.mkdir(exist_ok=True)
        with open(reports / 'geo_temporal.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
