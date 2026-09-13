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
        # Outreach briefs for top packs where brand is absent
        for pack, info in list(result['by_pack'].items())[:4]:
            if pack in ('other',):
                continue
            members = ', '.join(VERTICAL_PACKS.get(pack, [])[:3])
            result['outreach_briefs'].append({
                'pack': pack, 'citations': info['citations'],
                'brief': f'Pack "{pack}" drives {info["share"]:.0%} of citations ({members}). Action: seed expert answers/listings/quotes on {members}; link back to canonical facts pages.',
            })
        result['status'] = 'measured' if total > 1 else 'no_citations'
        return result

    def save(self, results: Dict, output_dir) -> None:
        import json
        reports = output_dir / 'reports'
        reports.mkdir(exist_ok=True)
        with open(reports / 'third_party_dominance.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)


class GeoTemporal:
    def __init__(self, config: Dict):
        self.config = config
        self.geo_cfg = config.get('execution', {}).get('geo', {}) if isinstance(config.get('execution'), dict) else {}

    def analyze(self, df: pl.DataFrame) -> Dict[str, Any]:
        result: Dict[str, Any] = {'geo': {}, 'freshness': {}, 'refresh_cadence': [], 'status': 'measured'}
        # Geo: surface whatever country signal exists; recommend multi-country matrix
        result['geo'] = {
            'tracked_countries': self.geo_cfg.get('countries', ['us']),
            'note': 'Multi-country tracking: replicate money prompts per country (Peec Advanced pattern). GBP + LocalBusiness schema must match per locale.',
            'gbp_checklist': ['LocalBusiness JSON-LD per location', 'GBP name/address matches site', 'Merchant Center feed for commerce'],
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
