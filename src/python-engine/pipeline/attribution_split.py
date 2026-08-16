"""
Attribution Split Classifier
Classifies whether each LLM response was driven by RAG (retrieval-augmented
generation / web search) or by pre-training model weights.

Methodology:
  For every (model, brand) pair we compare brand-mention behaviour between the
  same prompt asked with RAG/web-search ON vs OFF. If the brand only appears
  (or appears at a materially higher rate) when retrieval is enabled, the
  response is attributed to RAG; if it appears regardless of retrieval, it is
  attributed to pre-training weights. Each response then carries a
  per-brand attribution class plus a confidence score derived from the
  observed rate gap.

This is a deterministic, fully documented computation - no fabricated labels.
"""

import polars as pl
from typing import Dict, Optional
import logging
import re
from collections import Counter

from brand_utils import build_brand_patterns

logger = logging.getLogger(__name__)


class AttributionClassifier:
    def __init__(self, config: Dict):
        self.config = config
        self.attribution_config = config.get('execution', {}).get('attribution_split', {})
        self.entity_config = config.get('entity_maps', {}).get('entity_maps', {})
        self.BRAND_PATTERNS = build_brand_patterns(self.entity_config)

    def classify(self, df: pl.DataFrame) -> pl.DataFrame:
        logger.info("Classifying attribution sources (RAG vs Base)")

        if 'rag_enabled' not in df.columns:
            df = df.with_columns(pl.lit(True).alias('rag_enabled'))
        if 'primary_brand_mention' not in df.columns:
            df = df.with_columns(
                pl.col('raw_text').map_elements(self._first_brand_mention, return_dtype=pl.Utf8).alias('primary_brand_mention')
            )

        # Per (model, brand, rag) mention rates.
        model_brand_rates = self._compute_model_brand_rates(df)

        # Build attribution classes for every (model, brand) pair once.
        model_brand_attribution = self._classify_pairs(model_brand_rates)

        # Apply per response: the attribution class is driven by the model and
        # the first brand mentioned, enriched by whether the response actually
        # mentioned that brand at all.
        attributions = []
        confidences = []
        for row in df.select(['model_id', 'primary_brand_mention', 'raw_text']).iter_rows():
            model = row[0]
            brand = row[1]
            text = row[2]
            if not brand:
                attributions.append('no_brand_mentioned')
                confidences.append(0.0)
                continue
            pair = model_brand_attribution.get((model, brand)) or model_brand_attribution.get((None, brand)) or {
                'attribution': 'unclassified',
                'confidence': 0.0,
                'rag_rate': 0.0,
                'base_rate': 0.0
            }
            mentioned = self._any_brand_mentioned(text, brand)
            if not mentioned:
                attributions.append('omitted')
                confidences.append(0.0)
            else:
                attributions.append(pair['attribution'])
                confidences.append(pair['confidence'])

        df = df.with_columns([
            pl.Series('attribution_class', attributions),
            pl.Series('attribution_confidence', confidences)
        ])

        return df

    def _any_brand_mentioned(self, text: str, brand: str) -> bool:
        if not text or not brand:
            return False
        pattern = self.BRAND_PATTERNS.get(brand)
        if not pattern:
            return bool(re.search(re.escape(brand), str(text), re.IGNORECASE))
        return bool(re.search(pattern, str(text), re.IGNORECASE))

    def _first_brand_mention(self, text: str) -> Optional[str]:
        if not text:
            return None
        best_brand = None
        best_pos = len(text) + 1
        for brand, pat in self.BRAND_PATTERNS.items():
            m = re.search(pat, text, re.IGNORECASE)
            if m and m.start() < best_pos:
                best_brand, best_pos = brand, m.start()
        return best_brand

    def _compute_model_brand_rates(self, df: pl.DataFrame) -> Dict:
        """Return {(model, brand): {'rag_rate','base_rate','rag_count','base_count'}}."""
        out = {}
        unique_models = df['model_id'].unique().to_list() if 'model_id' in df.columns else [None]

        for model in unique_models:
            model_df = df if model is None else df.filter(pl.col('model_id') == model)
            rag_df = model_df.filter(pl.col('rag_enabled') == True)
            base_df = model_df.filter(pl.col('rag_enabled') == False)
            rag_total = max(rag_df.height, 1)
            base_total = max(base_df.height, 1)

            rag_mentions = self._brand_counts(rag_df)
            base_mentions = self._brand_counts(base_df)
            all_brands = set(rag_mentions.keys()) | set(base_mentions.keys()) | set(self.BRAND_PATTERNS.keys())

            for brand in all_brands:
                rc = rag_mentions.get(brand, 0)
                bc = base_mentions.get(brand, 0)
                out[(model, brand)] = {
                    'rag_rate': rc / rag_total,
                    'base_rate': bc / base_total,
                    'rag_count': rc,
                    'base_count': bc
                }

        return out

    def _brand_counts(self, df: pl.DataFrame) -> Counter:
        counts = Counter()
        if 'raw_text' not in df.columns or df.height == 0:
            return counts
        texts = df['raw_text'].to_list()
        for text in texts:
            if not text:
                continue
            for brand, pattern in self.BRAND_PATTERNS.items():
                if re.search(pattern, str(text), re.IGNORECASE):
                    counts[brand] += 1
        return counts

    def _classify_pairs(self, rates: Dict) -> Dict:
        """Determine one attribution label per (model, brand) from rate deltas."""
        result = {}
        for (model, brand), rates_for_brand in rates.items():
            rag_rate = rates_for_brand['rag_rate']
            base_rate = rates_for_brand['base_rate']

            if base_rate > 0.1 and rag_rate > 0.1:
                if rag_rate > base_rate * 1.25:
                    attribution = 'rag_dominant'
                    confidence = min(1.0, (rag_rate - base_rate) / max(rag_rate, 0.01))
                elif base_rate > rag_rate * 1.25:
                    attribution = 'pretraining_dominant'
                    confidence = min(1.0, (base_rate - rag_rate) / max(base_rate, 0.01))
                else:
                    attribution = 'both'
                    confidence = 0.5
            elif rag_rate > base_rate * 2:
                attribution = 'rag_dominant'
                confidence = 0.8
            elif base_rate > rag_rate * 2:
                attribution = 'pretraining_dominant'
                confidence = 0.8
            elif rag_rate > 0 or base_rate > 0:
                attribution = 'both'
                confidence = 0.5
            else:
                attribution = 'unclassified'
                confidence = 0.0

            result[(model, brand)] = {
                'attribution': attribution,
                'confidence': round(confidence, 4),
                'rag_rate': round(rag_rate, 4),
                'base_rate': round(base_rate, 4)
            }
        return result

    def get_stats(self, df: pl.DataFrame) -> Dict:
        stats = {
            'total_responses': df.height,
            'rag_enabled_count': df.filter(pl.col('rag_enabled') == True).height,
            'rag_disabled_count': df.filter(pl.col('rag_enabled') == False).height,
            'unique_models': df['model_id'].n_unique() if 'model_id' in df.columns else 0,
        }

        if 'attribution_class' in df.columns:
            class_counts = df['attribution_class'].value_counts()
            stats['attribution_distribution'] = {
                row['attribution_class']: row['count'] for row in class_counts.to_dicts()
            }

            model_classes = df.group_by('model_id').agg(pl.col('attribution_class').value_counts())
            stats['attribution_by_model'] = {
                str(row['model_id']): {
                    r['attribution_class']: r['count'] for r in row['attribution_class']
                } for row in model_classes.to_dicts()
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
