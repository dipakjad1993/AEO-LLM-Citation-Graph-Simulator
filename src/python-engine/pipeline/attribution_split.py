"""
Attribution Split Classifier
Classifies whether LLM responses are driven by RAG (Retrieval-Augmented Generation)
or pre-training model weights by comparing search-enabled vs search-disabled results.
"""

import polars as pl
from typing import Dict, List, Optional
import logging
import re
from collections import Counter

logger = logging.getLogger(__name__)

BRAND_PATTERNS = {
    'Brand_A': r'\bBrand[_ -]?A\b',
    'Brand_B': r'\bBrand[_ -]?B\b',
    'Brand_C': r'\bBrand[_ -]?C\b',
    'Competitor_B': r'\bCompetitor[_ -]?B\b',
    'Competitor_C': r'\bCompetitor[_ -]?C\b',
}


class AttributionClassifier:
    def __init__(self, config: Dict):
        self.config = config
        self.attribution_config = config.get('execution', {}).get('attribution_split', {})

    def classify(self, df: pl.DataFrame) -> pl.DataFrame:
        logger.info("Classifying attribution sources (RAG vs Base)")

        if 'rag_enabled' not in df.columns:
            df = df.with_columns(pl.lit(True).alias('rag_enabled'))

        rag_df = df.filter(pl.col('rag_enabled') == True)
        base_df = df.filter(pl.col('rag_enabled') == False)

        rag_brands = self._extract_brand_mentions(rag_df)
        base_brands = self._extract_brand_mentions(base_df)

        attribution_map = {}
        all_brands = set(list(rag_brands.keys()) + list(base_brands.keys()))

        for brand in all_brands:
            rag_count = rag_brands.get(brand, 0)
            base_count = base_brands.get(brand, 0)
            rag_total = rag_df.height or 1
            base_total = base_df.height or 1

            rag_rate = rag_count / rag_total
            base_rate = base_count / base_total

            if base_rate > 0.1 and rag_rate > 0.1:
                attribution = 'both'
                rag_weight = rag_rate / (rag_rate + base_rate)
                base_weight = base_rate / (rag_rate + base_rate)
            elif rag_rate > base_rate * 2:
                attribution = 'rag_dominant'
                rag_weight = 0.8
                base_weight = 0.2
            elif base_rate > rag_rate * 2:
                attribution = 'pretraining_dominant'
                rag_weight = 0.2
                base_weight = 0.8
            else:
                attribution = 'balanced'
                rag_weight = 0.5
                base_weight = 0.5

            attribution_map[brand] = {
                'attribution': attribution,
                'rag_mention_rate': rag_rate,
                'base_mention_rate': base_rate,
                'rag_weight': rag_weight,
                'base_weight': base_weight,
                'rag_count': rag_count,
                'base_count': base_count
            }

        df = df.with_columns([
            pl.struct([
                pl.col('model_id'),
                pl.col('rag_enabled')
            ]).map_elements(
                lambda x: self._classify_response(x, attribution_map),
                return_dtype=pl.Utf8
            ).alias('attribution_class')
        ])

        first_brand_expr = pl.lit(None, dtype=pl.Utf8)
        for brand, pat in BRAND_PATTERNS.items():
            first_brand_expr = pl.when(
                pl.col('raw_text').str.contains(pat, literal=False)
            ).then(pl.lit(brand)).otherwise(first_brand_expr)
        df = df.with_columns(first_brand_expr.alias('primary_brand_mention'))

        return df

    def _extract_brand_mentions(self, df: pl.DataFrame) -> Dict[str, int]:
        brand_counts = Counter()
        if 'raw_text' not in df.columns:
            return dict(brand_counts)

        for text in df['raw_text'].to_list():
            if not text:
                continue
            for brand, pattern in BRAND_PATTERNS.items():
                if re.search(pattern, str(text), re.IGNORECASE):
                    brand_counts[brand] += 1
        return dict(brand_counts)

    def _classify_response(self, struct_val, attribution_map: Dict) -> str:
        return 'classified'

    def get_stats(self, df: pl.DataFrame) -> Dict:
        stats = {
            'total_responses': df.height,
            'rag_enabled_count': df.filter(pl.col('rag_enabled') == True).height,
            'rag_disabled_count': df.filter(pl.col('rag_enabled') == False).height,
            'unique_models': df['model_id'].n_unique() if 'model_id' in df.columns else 0,
        }
        if 'primary_brand_mention' in df.columns:
            rag_brands = df.filter(pl.col('rag_enabled') == True)['primary_brand_mention'].drop_nulls().value_counts()
            base_brands = df.filter(pl.col('rag_enabled') == False)['primary_brand_mention'].drop_nulls().value_counts()
            stats['rag_brand_distribution'] = {
                row['primary_brand_mention']: row['count'] for row in rag_brands.to_dicts()
            } if rag_brands.height > 0 else {}
            stats['base_brand_distribution'] = {
                row['primary_brand_mention']: row['count'] for row in base_brands.to_dicts()
            } if base_brands.height > 0 else {}
        return stats
