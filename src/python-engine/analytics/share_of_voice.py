"""
Share of Model Voice (SoMV) Calculator
Computes entity citation share, primary recommendation rate,
mention rate, and omission rate across all models.
Optimized: batched brand counting, vectorized operations.
"""

import json
import re
import logging
from pathlib import Path
from typing import Dict, List, Any
from collections import Counter, defaultdict
from urllib.parse import urlparse

import polars as pl
import numpy as np

from brand_utils import build_brand_patterns

logger = logging.getLogger(__name__)


class ShareOfVoiceCalculator:
    def __init__(self, config: Dict):
        self.config = config
        self.entity_config = config.get('entity_maps', {}).get('entity_maps', {})
        self.primary_brand = self.entity_config.get('your_brand', {}).get('primary_name', '')
        self.competitors = [c['primary_name'] for c in self.entity_config.get('competitors', []) if c.get('primary_name')]
        self.all_brands = ([self.primary_brand] if self.primary_brand else []) + self.competitors
        if not self.all_brands:
            logger.warning("No brands configured in entity_maps.json. Share of Voice analysis requires at least your_brand.primary_name to be set.")
        self._brand_re = {b: re.compile(p, re.IGNORECASE) for b, p in build_brand_patterns(self.entity_config).items()}

    def _brand_mentioned(self, text: str, brand: str) -> bool:
        if not text:
            return False
        return bool(self._brand_re[brand].search(text))

    def _count_mentions_batch(self, texts: List[str], brand: str) -> int:
        pat = self._brand_re[brand]
        return sum(1 for t in texts if t and pat.search(str(t)))

    def _is_primary_mention(self, text: str, brand: str) -> bool:
        if not text:
            return False
        pat = self._brand_re[brand]
        sentences = re.split(r'[.!?]+', text[:1000])
        for sent in sentences[:3]:
            if pat.search(sent):
                if any(ind in sent.lower() for ind in ['recommend', 'top', 'best', 'leading', 'primary', 'first choice', 'market leader']):
                    return True
                if sentences.index(sent) == 0:
                    return True
        return False

    def calculate(self, df: pl.DataFrame) -> Dict:
        results = {
            'overall': {}, 'by_model': {}, 'by_persona': {},
            'by_turn_type': {}, 'by_turn_index': {},
            'rag_vs_base': {}, 'omission_analysis': {},
            'citation_depth': {}, 'competitive_gaps': {},
            'grounded_only': {}, 'grounding_diagnostics': {},
        }
        successful_df = df.filter(pl.col('success') == True)
        if successful_df.height == 0:
            return results

        results['overall'] = self._calculate_overall_sov(successful_df)
        results['by_model'] = self._calculate_sov_by_dimension(successful_df, 'model_id')
        results['by_persona'] = self._calculate_sov_by_dimension(successful_df, 'persona_id')
        results['by_turn_type'] = self._calculate_sov_by_dimension(successful_df, 'turn_type')
        results['by_turn_index'] = self._calculate_sov_by_turn_index(successful_df)
        results['rag_vs_base'] = self._calculate_rag_vs_base(successful_df)
        results['omission_analysis'] = self._analyze_omissions(successful_df)
        results['citation_depth'] = self._analyze_citation_depth(successful_df)
        results['competitive_gaps'] = self._identify_competitive_gaps(results)
        # 2026 methodology honesty: grounded-only SoMV + browse diagnostics.
        results['grounded_only'] = self._calculate_grounded_only(successful_df)
        results['grounding_diagnostics'] = self._grounding_diagnostics(successful_df)
        return results

    def _sov_for_df(self, sub_df: pl.DataFrame, total: int) -> Dict:
        raw_texts = sub_df['raw_text'].to_list()
        brand_stats = {}
        total_mentions_all = 0
        for brand in self.all_brands:
            mention_count = self._count_mentions_batch(raw_texts, brand)
            total_mentions_all += mention_count
            primary_count = sum(1 for t in raw_texts if t and self._brand_mentioned(str(t), brand) and self._is_primary_mention(str(t), brand))
            brand_stats[brand] = {
                'mention_count': mention_count,
                'mention_rate': mention_count / total if total > 0 else 0,
                'primary_recommendation_count': primary_count,
                'primary_recommendation_rate': primary_count / total if total > 0 else 0,
                'secondary_mention_count': mention_count - primary_count,
                'omission_rate': 1 - (mention_count / total) if total > 0 else 1
            }
        total_mentions_all = total_mentions_all or 1
        for brand in brand_stats:
            brand_stats[brand]['share_of_voice'] = brand_stats[brand]['mention_count'] / total_mentions_all
        return {'total_responses': total, 'brand_stats': brand_stats,
                'leadership_ranking': sorted(brand_stats.items(), key=lambda x: x[1]['primary_recommendation_rate'], reverse=True)}

    def _calculate_overall_sov(self, df: pl.DataFrame) -> Dict:
        return self._sov_for_df(df, df.height)

    def _calculate_sov_by_dimension(self, df: pl.DataFrame, dimension: str) -> Dict:
        if dimension not in df.columns:
            return {}
        result = {}
        unique_values = df[dimension].unique().to_list()
        for dim_value in unique_values:
            dim_df = df.filter(pl.col(dimension) == dim_value)
            sov = self._sov_for_df(dim_df, dim_df.height)
            result[str(dim_value)] = {'total': dim_df.height, 'brand_stats': sov['brand_stats']}
        return result

    def _calculate_sov_by_turn_index(self, df: pl.DataFrame) -> Dict:
        result = {}
        turn_indices = sorted(df['turn_index'].unique().to_list())
        for turn_idx in turn_indices:
            turn_df = df.filter(pl.col('turn_index') == turn_idx)
            raw_texts = turn_df['raw_text'].to_list()
            brand_stats = {}
            for brand in self.all_brands:
                mc = self._count_mentions_batch(raw_texts, brand)
                brand_stats[brand] = {'mention_count': mc, 'mention_rate': mc / turn_df.height if turn_df.height > 0 else 0}
            result[f'turn_{turn_idx}'] = {'total': turn_df.height, 'brand_stats': brand_stats}
        return result

    def _calculate_rag_vs_base(self, df: pl.DataFrame) -> Dict:
        result = {}
        rag_df = df.filter(pl.col('rag_enabled') == True)
        base_df = df.filter(pl.col('rag_enabled') == False)
        for label, sub_df in [('rag_enabled', rag_df), ('rag_disabled', base_df)]:
            raw_texts = sub_df['raw_text'].to_list()
            brand_stats = {}
            for brand in self.all_brands:
                mc = self._count_mentions_batch(raw_texts, brand)
                brand_stats[brand] = {'mention_rate': mc / sub_df.height if sub_df.height > 0 else 0, 'mention_count': mc}
            result[label] = {'total': sub_df.height, 'brand_stats': brand_stats}
        if 'rag_enabled' in result and 'rag_disabled' in result:
            attribution_insights = []
            for brand in self.all_brands:
                rag_rate = result['rag_enabled']['brand_stats'].get(brand, {}).get('mention_rate', 0)
                base_rate = result['rag_disabled']['brand_stats'].get(brand, {}).get('mention_rate', 0)
                delta = rag_rate - base_rate
                if abs(delta) > 0.05:
                    attribution_insights.append({
                        'brand': brand, 'rag_rate': rag_rate, 'base_rate': base_rate,
                        'delta': delta,
                        'attribution': 'rag_boosted' if delta > 0 else 'pretraining_boosted',
                        'insight': f"{brand} gets a RAG boost of {delta:.1%}. {'Focus on RAG/indexing.' if delta > 0 else 'Focus on PR/Wikipedia.'}"
                    })
            result['attribution_insights'] = attribution_insights
        return result

    def _analyze_omissions(self, df: pl.DataFrame) -> Dict:
        result = {'omission_rates': {}, 'co_omission_patterns': [], 'omission_by_model': {}}
        total = df.height
        raw_texts = df['raw_text'].to_list()
        for brand in self.all_brands:
            mc = self._count_mentions_batch(raw_texts, brand)
            result['omission_rates'][brand] = {'omitted_count': total - mc, 'omission_rate': 1 - (mc / total) if total > 0 else 1}
        unique_models = df['model_id'].unique().to_list()
        for model in unique_models:
            model_df = df.filter(pl.col('model_id') == model)
            mt = model_df.height
            m_texts = model_df['raw_text'].to_list()
            brand_rates = {}
            for brand in self.all_brands:
                brand_rates[brand] = self._count_mentions_batch(m_texts, brand) / mt if mt > 0 else 0
            result['omission_by_model'][model] = brand_rates
        return result

    def _analyze_citation_depth(self, df: pl.DataFrame) -> Dict:
        result = {'avg_citations_per_response': 0, 'citation_distribution': {}, 'citation_by_model': {}, 'top_cited_domains': {}}
        try:
            cit_col = df['citations'].to_list()
        except Exception:
            cit_col = [None] * df.height
        citation_counts = []
        all_urls = []
        for c in cit_col:
            if isinstance(c, list):
                citation_counts.append(len(c))
                for item in c:
                    if isinstance(item, dict) and item.get('url'):
                        all_urls.append(item['url'])
            else:
                citation_counts.append(0)
        if citation_counts:
            arr = np.array(citation_counts)
            result['avg_citations_per_response'] = float(np.mean(arr))
            result['citation_distribution'] = {
                'zero_citations': int(np.sum(arr == 0)),
                'one_citation': int(np.sum(arr == 1)),
                'two_to_five': int(np.sum((arr >= 2) & (arr <= 5))),
                'six_plus': int(np.sum(arr > 5))
            }
        domain_counts = Counter()
        for url in all_urls:
            try:
                domain = urlparse(url).netloc.lower()
                if domain.startswith('www.'):
                    domain = domain[4:]
                domain_counts[domain] += 1
            except Exception:
                continue
        result['top_cited_domains'] = dict(domain_counts.most_common(20))
        return result

    def _calculate_grounded_only(self, df: pl.DataFrame) -> Dict:
        """SoMV computed ONLY on responses with browse evidence (the honest number)."""
        if 'search_performed' not in df.columns:
            return {'status': 'no_grounding_signal', 'message': 'No search_performed flag — re-run orchestrator to capture browse evidence.'}
        grounded = df.filter(pl.col('search_performed') == True)
        ungrounded = df.filter(pl.col('search_performed') != True)
        out = {
            'grounded_responses': grounded.height,
            'ungrounded_responses': ungrounded.height,
            'grounded_share': round(grounded.height / df.height, 4) if df.height else 0,
            'overall': self._sov_for_df(grounded, grounded.height) if grounded.height else {},
            'by_model': self._calculate_sov_by_dimension(grounded, 'model_id') if grounded.height else {},
        }
        # Per-model browse rate exposes the "74% problem" (ChatGPT API skips browsing ~26%).
        browse_by_model = {}
        if 'model_id' in df.columns:
            for m in df['model_id'].unique().to_list():
                sub = df.filter(pl.col('model_id') == m)
                g = sub.filter(pl.col('search_performed') == True).height
                browse_by_model[str(m)] = {
                    'browse_rate': round(g / sub.height, 4) if sub.height else 0,
                    'grounded': g, 'total': sub.height,
                    'flag': 'LOW_BROWSE_RATE' if sub.height >= 5 and g / sub.height < 0.5 else 'OK',
                }
        out['browse_rate_by_model'] = browse_by_model
        if out['grounded_share'] < 0.74:
            out['warning'] = (f"Only {out['grounded_share']:.0%} of responses show browse evidence. "
                              'Ungrounded (memory) answers inflate/deflate SoMV — use grounded_only for decisions.')
        return out

    def _grounding_diagnostics(self, df: pl.DataFrame) -> Dict:
        diag = {'requested_vs_performed': {}, 'variance_flag': False}
        if 'search_performed' not in df.columns:
            return diag
        req_col = 'search_requested' if 'search_requested' in df.columns else 'rag_enabled'
        try:
            req = df.filter(pl.col(req_col) == True).height
            perf = df.filter(pl.col('search_performed') == True).height
            diag['requested_vs_performed'] = {
                'search_requested': req, 'search_performed': perf,
                'skip_rate': round(1 - perf / req, 4) if req else 0,
            }
            diag['variance_flag'] = bool(req and (1 - perf / req) > 0.2)
            if diag['variance_flag']:
                diag['finding'] = (f"{diag['requested_vs_performed']['skip_rate']:.0%} of browse-requested calls "
                                   'answered from memory. Filter to grounded-only before reporting SoMV.')
        except Exception:
            pass
        return diag

    def _identify_competitive_gaps(self, results: Dict) -> List[Dict]:
        gaps = []
        brand_stats = results.get('overall', {}).get('brand_stats', {})
        your_stats = brand_stats.get(self.primary_brand, {})
        your_primary = your_stats.get('primary_recommendation_rate', 0)
        for comp in self.competitors:
            comp_stats = brand_stats.get(comp, {})
            comp_primary = comp_stats.get('primary_recommendation_rate', 0)
            if comp_primary > your_primary:
                gaps.append({
                    'competitor': comp,
                    'your_primary_rate': your_primary,
                    'competitor_primary_rate': comp_primary,
                    'gap': comp_primary - your_primary,
                    'recommendation': f"Investigate why {comp} leads with {comp_primary:.1%} vs your {your_primary:.1%}"
                })
        return sorted(gaps, key=lambda x: x['gap'], reverse=True)

    def save(self, results: Dict, output_dir: Path):
        reports_dir = output_dir / 'reports'
        reports_dir.mkdir(exist_ok=True)
        with open(reports_dir / 'share_of_model_voice.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
        lines = ["=" * 100, "EXECUTIVE SHARE OF MODEL VOICE (SoMV)", "=" * 100, ""]
        overall = results.get('overall', {})
        brand_stats = overall.get('brand_stats', {})
        by_model = results.get('by_model', {})
        for model, data in by_model.items():
            row = f"{model:<25}"
            for brand in self.all_brands:
                stats = data.get('brand_stats', {}).get(brand, {})
                pr = stats.get('primary_recommendation_rate', 0)
                mr = stats.get('mention_rate', 0)
                status = "Primary" if pr > 0.4 else "Secondary" if mr > 0.3 else "Mentioned" if mr > 0 else "Unmentioned"
                row += f" | {pr:.0%} ({status}){'':<15}"
            lines.append(row)
        lines.append("=" * 100)
        with open(reports_dir / 'somv_table.txt', 'w') as f:
            f.write('\n'.join(lines))
        logger.info(f"Saved SoMV analysis to {reports_dir}")
