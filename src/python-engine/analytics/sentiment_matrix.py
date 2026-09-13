"""
Sentiment & Hallucination Detection Matrix
Detects recurring negative patterns, biases, and potential hallucinations
in LLM outputs across models and conversation turns.
Optimized: Polars vectorized ops for brand matching and sentence processing.
"""

import json
import re
import logging
from pathlib import Path
from typing import Dict, List, Any
from collections import Counter, defaultdict

import polars as pl
import numpy as np

from brand_utils import build_brand_patterns

logger = logging.getLogger(__name__)

try:
    from transformers import pipeline
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False


class SentimentMatrix:
    def __init__(self, config: Dict):
        self.config = config
        self.sentiment_config = config.get('analytics', {}).get('sentiment', {})
        self.positive_threshold = self.sentiment_config.get('positive_threshold', 0.6)
        self.negative_threshold = self.sentiment_config.get('negative_threshold', 0.4)
        self.entity_config = config.get('entity_maps', {}).get('entity_maps', {})
        self.brand_patterns = build_brand_patterns(self.entity_config)

        self.bias_patterns = {
            'manual_migration': r'manual\s+(database\s+)?migration',
            'limited_integration': r'limited\s+(third[- ]party\s+)?integration',
            'complex_pricing': r'(complex|confusing|unclear)\s+pricing',
            'poor_support': r'(poor|slow|unresponsive)\s+(customer\s+)?support',
            'security_concern': r'(security|compliance)\s+(concern|risk|issue|problem)',
            'vendor_lock_in': r'vendor\s+lock[- ]?in',
            'steep_learning': r'steep\s+learning\s+curve',
            'outdated': r'(outdated|legacy|old[- fashioned])',
            'expensive': r'(expensive|overpriced|costly|high[- ]priced)',
            'slow_performance': r'(slow|sluggish|poor)\s+performance'
        }

        self.positive_words = {
            'excellent', 'best', 'leading', 'top', 'innovative', 'powerful', 'reliable',
            'trusted', 'recommended', 'superior', 'strong', 'robust', 'comprehensive',
            'seamless', 'efficient', 'flexible', 'scalable', 'secure', 'fast'
        }
        self.negative_words = {
            'lack', 'lacks', 'missing', 'weak', 'poor', 'problem', 'issue', 'concern',
            'failure', 'expensive', 'difficult', 'complex', 'complicated', 'slow',
            'outdated', 'inadequate', 'insufficient', 'risky', 'vulnerable'
        }
        self.negation_words = {'not', "n't", 'no', 'never', 'without', 'neither', 'nor'}

        self._classifier = None
        self.sentiment_engine = 'keyword'
        if TRANSFORMERS_AVAILABLE and self.sentiment_config.get('use_transformer', True):
            model_name = self.sentiment_config.get('model', 'cardiffnlp/twitter-roberta-base-sentiment-latest')
            try:
                self._classifier = pipeline(
                    'sentiment-analysis', model=model_name, device=-1,
                    truncation=True, max_length=512
                )
                self.sentiment_engine = 'roberta'
                logger.info(f"Loaded RoBERTa sentiment model: {model_name}")
            except Exception as e:
                logger.warning(f"Failed to load RoBERTa sentiment model ({model_name}); falling back to keyword analysis: {e}")
                self._classifier = None

    def analyze(self, df: pl.DataFrame) -> Dict:
        results = {
            'total_analyzed': df.height,
            'brand_sentiment_matrix': {},
            'model_sentiment_matrix': {},
            'turn_sentiment_evolution': {},
            'detected_biases': [],
            'hallucination_signals': [],
            'negative_pattern_clusters': {},
            'sentiment_summary': {},
            'sentiment_engine': self.sentiment_engine
        }
        successful_df = df.filter(pl.col('success') == True)
        if successful_df.height == 0:
            return results

        results['brand_sentiment_matrix'] = self._build_brand_sentiment_matrix(successful_df)
        results['model_sentiment_matrix'] = self._build_model_sentiment_matrix(successful_df)
        results['turn_sentiment_evolution'] = self._track_turn_evolution(successful_df)
        results['detected_biases'] = self._detect_biases(successful_df)
        results['hallucination_signals'] = self._detect_hallucination_signals(successful_df)
        results['negative_pattern_clusters'] = self._cluster_negative_patterns(successful_df)
        results['sentiment_summary'] = self._generate_summary(results)
        return results

    def _classify_sentence(self, sentence: str) -> Dict:
        """Classify a sentence's sentiment using RoBERTa when available, else keyword heuristics."""
        if self._classifier is not None:
            try:
                res = self._classifier(sentence[:500])[0]
                label = res['label'].lower()
                if 'positive' in label:
                    return {'score': 0.5 + float(res['score']) / 2, 'positive_count': 1, 'negative_count': 0, 'label': 'positive', 'engine': 'roberta'}
                if 'negative' in label:
                    return {'score': 0.5 - float(res['score']) / 2, 'positive_count': 0, 'negative_count': 1, 'label': 'negative', 'engine': 'roberta'}
                return {'score': 0.5, 'positive_count': 0, 'negative_count': 0, 'label': 'neutral', 'engine': 'roberta'}
            except Exception as e:
                logger.debug(f"RoBERTa classification failed, using keyword fallback: {e}")
        return {**self._analyze_sentence_sentiment(sentence), 'engine': 'keyword'}

    def _analyze_sentence_sentiment(self, sentence: str) -> Dict:
        words = re.findall(r'\b\w+\b', sentence.lower())
        pos_count = neg_count = 0
        negate = False
        for word in words:
            if word in self.negation_words:
                negate = True
                continue
            if word in self.positive_words:
                if negate:
                    neg_count += 1
                else:
                    pos_count += 1
                negate = False
            elif word in self.negative_words:
                if negate:
                    pos_count += 1
                else:
                    neg_count += 1
                negate = False
            else:
                negate = False
        total = pos_count + neg_count or 1
        score = pos_count / total
        return {
            'score': score,
            'positive_count': pos_count,
            'negative_count': neg_count,
            'label': 'positive' if score > self.positive_threshold else 'negative' if score < self.negative_threshold else 'neutral'
        }

    def _get_brand_sentences(self, text: str) -> Dict[str, List[str]]:
        if not text or not isinstance(text, str):
            return {}
        sentences = re.split(r'[.!?]+', text)
        result = {}
        for brand_name, pattern in self.brand_patterns.items():
            brand_sents = [s.strip() for s in sentences if re.search(pattern, s, re.IGNORECASE) and len(s.strip()) > 10]
            if brand_sents:
                result[brand_name] = brand_sents
        return result

    def _build_brand_sentiment_matrix(self, df: pl.DataFrame) -> Dict:
        matrix = defaultdict(lambda: {
            'positive_count': 0, 'negative_count': 0, 'neutral_count': 0,
            'total_mentions': 0, 'sentiment_scores': [],
            'positive_examples': [], 'negative_examples': []
        })

        raw_texts = df['raw_text'].to_list()
        model_ids = df['model_id'].to_list() if 'model_id' in df.columns else [''] * len(raw_texts)

        for text, model_id in zip(raw_texts, model_ids):
            brand_sents = self._get_brand_sentences(text)
            for brand_name, sents in brand_sents.items():
                matrix[brand_name]['total_mentions'] += len(sents)
                for sent in sents:
                    sentiment = self._classify_sentence(sent)
                    score = sentiment['score']
                    matrix[brand_name]['sentiment_scores'].append(score)
                    if score > self.positive_threshold:
                        matrix[brand_name]['positive_count'] += 1
                        if len(matrix[brand_name]['positive_examples']) < 5:
                            matrix[brand_name]['positive_examples'].append({'text': sent[:200], 'model': model_id, 'score': score})
                    elif score < self.negative_threshold:
                        matrix[brand_name]['negative_count'] += 1
                        if len(matrix[brand_name]['negative_examples']) < 5:
                            matrix[brand_name]['negative_examples'].append({'text': sent[:200], 'model': model_id, 'score': score})
                    else:
                        matrix[brand_name]['neutral_count'] += 1

        result = {}
        for brand, data in matrix.items():
            total = data['total_mentions'] or 1
            scores = data['sentiment_scores'] or [0.5]
            result[brand] = {
                'positive_rate': data['positive_count'] / total,
                'negative_rate': data['negative_count'] / total,
                'neutral_rate': data['neutral_count'] / total,
                'total_mentions': data['total_mentions'],
                'mean_sentiment_score': float(np.mean(scores)),
                'std_sentiment_score': float(np.std(scores)),
                'positive_examples': data['positive_examples'],
                'negative_examples': data['negative_examples']
            }
        return result

    def _build_model_sentiment_matrix(self, df: pl.DataFrame) -> Dict:
        matrix = defaultdict(lambda: defaultdict(lambda: {'positive': 0, 'negative': 0, 'neutral': 0, 'total': 0}))
        main_brands = self.brand_patterns

        raw_texts = df['raw_text'].to_list()
        model_ids = df['model_id'].to_list() if 'model_id' in df.columns else [''] * len(raw_texts)

        for text, model_id in zip(raw_texts, model_ids):
            if not text or not model_id:
                continue
            sentences = re.split(r'[.!?]+', text)
            for brand_name, pattern in main_brands.items():
                brand_sents = [s.strip() for s in sentences if re.search(pattern, s, re.IGNORECASE)]
                for sent in brand_sents:
                    sentiment = self._classify_sentence(sent)
                    if sentiment['score'] > self.positive_threshold:
                        matrix[model_id][brand_name]['positive'] += 1
                    elif sentiment['score'] < self.negative_threshold:
                        matrix[model_id][brand_name]['negative'] += 1
                    else:
                        matrix[model_id][brand_name]['neutral'] += 1
                    matrix[model_id][brand_name]['total'] += 1

        result = {}
        for model, brands in matrix.items():
            result[model] = {}
            for brand, counts in brands.items():
                total = counts['total'] or 1
                result[model][brand] = {
                    'positive_rate': counts['positive'] / total,
                    'negative_rate': counts['negative'] / total,
                    'neutral_rate': counts['neutral'] / total,
                    'total_mentions': counts['total']
                }
        return result

    def _track_turn_evolution(self, df: pl.DataFrame) -> Dict:
        evolution = defaultdict(lambda: defaultdict(list))
        raw_texts = df['raw_text'].to_list()
        turn_indices = df['turn_index'].to_list() if 'turn_index' in df.columns else [0] * len(raw_texts)
        brands_list = df['primary_brand_mention'].to_list() if 'primary_brand_mention' in df.columns else [''] * len(raw_texts)

        for text, turn_index, brand in zip(raw_texts, turn_indices, brands_list):
            if not text or not brand:
                continue
            sentiment = self._classify_sentence(text)
            evolution[turn_index][brand].append(sentiment['score'])

        result = {}
        for turn, brands in sorted(evolution.items()):
            result[f'turn_{turn}'] = {}
            for brand, scores in brands.items():
                arr = np.array(scores)
                result[f'turn_{turn}'][brand] = {
                    'mean_sentiment': float(np.mean(arr)),
                    'std_sentiment': float(np.std(arr)),
                    'sample_size': len(scores),
                    'negative_rate': float(np.sum(arr < self.negative_threshold)) / max(len(scores), 1)
                }
        return result

    def _detect_biases(self, df: pl.DataFrame) -> List[Dict]:
        biases = []
        pattern_cooccurrence = defaultdict(lambda: defaultdict(int))

        raw_texts = df['raw_text'].to_list()
        model_ids = df['model_id'].to_list() if 'model_id' in df.columns else [''] * len(raw_texts)
        brands_list = df['primary_brand_mention'].to_list() if 'primary_brand_mention' in df.columns else [''] * len(raw_texts)

        for text, model_id, brand in zip(raw_texts, model_ids, brands_list):
            if not text:
                continue
            for bias_name, pattern in self.bias_patterns.items():
                matches = re.findall(pattern, text, re.IGNORECASE)
                if matches:
                    pattern_cooccurrence[brand][bias_name] += len(matches)

        import math as _math
        n_resp = len([t for t in raw_texts if t]) or 1

        def _wilson(p, n, z=1.96):
            if n <= 0:
                return (0.0, 0.0)
            denom = 1 + z * z / n
            center = p + z * z / (2 * n)
            margin = z * _math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
            return (round(max(0.0, (center - margin) / denom), 4), round(min(1.0, (center + margin) / denom), 4))

        for brand, patterns in pattern_cooccurrence.items():
            for pattern_name, count in patterns.items():
                if count >= 3:
                    # Wilson CI over response prevalence (responses containing the pattern
                    # at least once / non-empty responses). n<30 = wide bars, honestly shown.
                    import re as _re
                    pat = self.bias_patterns[pattern_name]
                    hit_resp = sum(1 for t in raw_texts if t and _re.search(pat, t, _re.IGNORECASE))
                    rate = hit_resp / n_resp
                    biases.append({
                        'brand': brand, 'bias_pattern': pattern_name,
                        'occurrence_count': count,
                        'response_prevalence': round(rate, 4),
                        'response_prevalence_ci95': _wilson(rate, n_resp),
                        'n_responses': n_resp,
                        'pattern_display': pattern_name.replace('_', ' ').title(),
                        'severity': 'HIGH' if count >= 10 else 'MEDIUM' if count >= 5 else 'LOW',
                        'remediation': self._get_remediation(pattern_name, brand)
                    })
        biases.sort(key=lambda x: x['occurrence_count'], reverse=True)
        return biases[:20]

    def _detect_hallucination_signals(self, df: pl.DataFrame) -> List[Dict]:
        signals = []
        brand_claims = defaultdict(lambda: defaultdict(list))
        claim_patterns = [
            (re.compile(r'(\w+)\s+(?:was|were)\s+(acquired|merged| shut down| bankrupt)', re.I), 'corporate_event'),
            (re.compile(r'(\w+)\s+(?:launched|released|announced)\s+(?:in|on)\s+(\w+\s+\d{4})', re.I), 'product_launch'),
            (re.compile(r'(\w+)\s+(?:has|have)\s+(\d+)\s+(?:employees|users|customers)', re.I), 'company_metric'),
            (re.compile(r'(\w+)\s+(?:is|are)\s+(?:priced at|costs?)\s+\$?([\d,]+)', re.I), 'pricing_claim'),
        ]

        raw_texts = df['raw_text'].to_list()
        model_ids = df['model_id'].to_list() if 'model_id' in df.columns else [''] * len(raw_texts)

        for text, model_id in zip(raw_texts, model_ids):
            if not text:
                continue
            for pattern, claim_type in claim_patterns:
                for match in pattern.finditer(text):
                    brand = match.group(1)
                    claim = match.group(0)
                    brand_claims[brand][claim_type].append({
                        'claim': claim, 'model': model_id,
                        'context': text[max(0, match.start()-50):min(len(text), match.end()+50)]
                    })

        for brand, claim_types in brand_claims.items():
            for claim_type, claims in claim_types.items():
                if len(claims) >= 3:
                    unique_claims = set(c['claim'] for c in claims)
                    if len(unique_claims) > 1:
                        signals.append({
                            'brand': brand, 'claim_type': claim_type,
                            'conflicting_claims': list(unique_claims),
                            'occurrence_count': len(claims),
                            'models_reporting': list(set(c['model'] for c in claims)),
                            'confidence': 'LOW' if len(unique_claims) > 2 else 'MEDIUM',
                            'action': f"Verify {claim_type} claims for {brand} across multiple sources"
                        })
        return signals[:15]

    def _cluster_negative_patterns(self, df: pl.DataFrame) -> Dict:
        clusters = defaultdict(lambda: {'count': 0, 'models': set(), 'examples': []})
        negative_indicators = [
            r'(?i)(?:problem|issue|concern|risk|weakness|failure|complaint)',
            r'(?i)(?:lack|missing|absent|without|no\s+\w+\s+support)',
            r'(?i)(?:expensive|overpriced|costly|high\s+total\s+cost)',
            r'(?i)(?:complex|complicated|difficult|steep\s+learning)',
            r'(?i)(?:slow|sluggish|latency|downtime|outage)'
        ]

        raw_texts = df['raw_text'].to_list()
        model_ids = df['model_id'].to_list() if 'model_id' in df.columns else [''] * len(raw_texts)
        brands_list = df['primary_brand_mention'].to_list() if 'primary_brand_mention' in df.columns else [''] * len(raw_texts)

        for text, model_id, brand in zip(raw_texts, model_ids, brands_list):
            if not text or not brand:
                continue
            for pattern in negative_indicators:
                matches = re.findall(pattern, text)
                if matches:
                    cluster_key = f"{brand}:{pattern}"
                    clusters[cluster_key]['count'] += len(matches)
                    clusters[cluster_key]['models'].add(model_id)
                    if len(clusters[cluster_key]['examples']) < 3:
                        clusters[cluster_key]['examples'].append(text[:200])

        result = {}
        for key, data in sorted(clusters.items(), key=lambda x: x[1]['count'], reverse=True)[:15]:
            brand, pattern = key.split(':', 1)
            result[key] = {
                'brand': brand, 'pattern': pattern, 'count': data['count'],
                'models': list(data['models']), 'examples': data['examples']
            }
        return result

    def _get_remediation(self, pattern_name: str, brand: str) -> str:
        remediations = {
            'manual_migration': f"Publish automated migration documentation and tutorials to counter the '{brand} requires manual migration' narrative",
            'limited_integration': f"Create integration marketplace page and publish comprehensive API documentation showing all supported integrations",
            'complex_pricing': f"Publish transparent pricing comparison tables and ROI calculators to address pricing complexity concerns",
            'poor_support': f"Publish customer success stories, SLA guarantees, and support response time statistics",
            'security_concern': f"Update security documentation, publish compliance audit results, and create SOC2/HIPAA certification pages",
            'vendor_lock_in': f"Publish data portability documentation, open API standards compliance, and migration guides away from competitors",
            'steep_learning': f"Create beginner-friendly tutorials, onboarding guides, and certification programs to demonstrate ease of adoption",
            'outdated': f"Publish recent product update announcements, innovation roadmap, and technology stack modernization posts",
            'expensive': f"Create total cost of ownership comparisons and ROI calculators showing long-term value",
            'slow_performance': f"Publish performance benchmarks, SLA metrics, and infrastructure architecture documentation"
        }
        return remediations.get(pattern_name, f"Address the {pattern_name.replace('_', ' ')} narrative for {brand} with targeted content")

    def _generate_summary(self, results: Dict) -> Dict:
        brand_sentiment = results.get('brand_sentiment_matrix', {})
        primary_brand = self.entity_config.get('your_brand', {}).get('primary_name', '')
        summary = {
            'most_positively_perceived': None,
            'most_negatively_perceived': None,
            'primary_brand_sentiment_rank': None,
            'primary_brand_name': primary_brand,
            'total_biases_detected': len(results.get('detected_biases', [])),
            'total_hallucination_signals': len(results.get('hallucination_signals', [])),
            'critical_biases': [b for b in results.get('detected_biases', []) if b['severity'] == 'HIGH']
        }
        if brand_sentiment:
            sorted_brands = sorted(brand_sentiment.items(), key=lambda x: x[1].get('mean_sentiment_score', 0.5), reverse=True)
            if sorted_brands:
                summary['most_positively_perceived'] = sorted_brands[0][0]
                summary['most_negatively_perceived'] = sorted_brands[-1][0]
            if primary_brand:
                for i, (brand, _) in enumerate(sorted_brands):
                    if brand == primary_brand:
                        summary['primary_brand_sentiment_rank'] = i + 1
        return summary

    def save(self, results: Dict, output_dir: Path):
        reports_dir = output_dir / 'reports'
        reports_dir.mkdir(exist_ok=True)
        with open(reports_dir / 'sentiment_matrix.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
        logger.info(f"Saved sentiment matrix to {reports_dir}")
