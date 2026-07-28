"""
Semantic Triple Extractor
Extracts Subject-Predicate-Object triples from LLM response text using
spaCy dependency parsing and pattern-based extraction for entity co-occurrence analysis.
Optimized: pre-compiled regex, batched spaCy, vectorized brand matching.
"""

import re
import logging
from typing import Dict, List, Tuple, Optional, Any
from collections import Counter, defaultdict

import polars as pl

logger = logging.getLogger(__name__)

try:
    import spacy
    SPACY_AVAILABLE = True
except ImportError:
    SPACY_AVAILABLE = False
    logger.warning("spaCy not available, using pattern-based fallback")

BRAND_PATTERN = re.compile(r'Brand[_ -]?[ABC]|Competitor[_ -]?[BC]', re.IGNORECASE)
BRAND_MATCH_PATTERNS = {
    'Brand_A': re.compile(r'\bBrand[_ -]?A\b', re.IGNORECASE),
    'Brand_B': re.compile(r'\bBrand[_ -]?B\b', re.IGNORECASE),
    'Brand_C': re.compile(r'\bBrand[_ -]?C\b', re.IGNORECASE),
    'Competitor_B': re.compile(r'\bCompetitor[_ -]?B\b', re.IGNORECASE),
    'Competitor_C': re.compile(r'\bCompetitor[_ -]?C\b', re.IGNORECASE),
}

VERB_PATTERNS = [
    (re.compile(r'(\b\w[\w\s]*?\b)\s+(provides?|offers?|includes?|supports?|features?|delivers?)\s+(\w[\w\s]*?)(?:\.|,|;|$)', re.I), 'positive'),
    (re.compile(r"(\b\w[\w\s]*?\b)\s+(lacks?|missing|doesn't have|without|no|fails? to)\s+(\w[\w\s]*?)(?:\.|,|;|$)", re.I), 'negative'),
    (re.compile(r'(\b\w[\w\s]*?\b)\s+(is|are)\s+(known for|recognized for|praised for)\s+(\w[\w\s]*?)(?:\.|,|;|$)', re.I), 'positive'),
    (re.compile(r'(\b\w[\w\s]*?\b)\s+(is|are)\s+(criticized for|faulted for|noted for)\s+(\w[\w\s]*?)(?:\.|,|;|$)', re.I), 'negative'),
    (re.compile(r'(\b\w[\w\s]*?\b)\s+(uses?|utilizes?|employs?|relies on)\s+(\w[\w\s]*?)(?:\.|,|;|$)', re.I), 'neutral'),
    (re.compile(r'(\b\w[\w\s]*?\b)\s+(implements?|integrates?|adopts?)\s+(\w[\w\s]*?)(?:\.|,|;|$)', re.I), 'neutral'),
]

COMPARATIVE_PATTERNS = [
    (re.compile(r'(\w[\w\s]*?)\s+(?:is|are)\s+(?:better|worse|faster|slower|more|less)\s+than\s+([\w\s]+)', re.I), 'comparative'),
    (re.compile(r'(\w[\w\s]*?)\s+compared\s+to\s+([\w\s]+)', re.I), 'comparative'),
    (re.compile(r'(\w[\w\s]*?)\s+vs\.?\s+([\w\s]+)', re.I), 'comparative'),
    (re.compile(r'(\w[\w\s]*?)\s+outperform[s]?\s+([\w\s]+)', re.I), 'positive_comparative'),
    (re.compile(r'(\w[\w\s]*?)\s+underperform[s]?\s+([\w\s]+)', re.I), 'negative_comparative'),
]


def _match_brand(text: str, brand_hint: str = '') -> str:
    for brand, pat in BRAND_MATCH_PATTERNS.items():
        if pat.search(text):
            return brand
    if brand_hint and re.search(brand_hint.replace('_', '[_ -]?'), text, re.IGNORECASE):
        return brand_hint
    return 'Unknown'


def _classify_sentiment(predicate: str, is_negated: bool) -> str:
    pred_lower = predicate.lower()
    pos_words = {'provides', 'offers', 'includes', 'supports', 'features', 'delivers', 'excels',
                 'superior', 'leading', 'best', 'top', 'excellent', 'innovative',
                 'reliable', 'trusted', 'recommended', 'strong', 'robust', 'comprehensive'}
    neg_words = {'lacks', 'missing', 'without', 'no', 'fails', 'poor',
                 'weak', 'inadequate', 'insufficient', 'problematic', 'concerning',
                 'expensive', 'complicated', 'difficult', 'complex'}
    if is_negated:
        for w in pos_words:
            if w in pred_lower:
                return 'negative'
    for w in neg_words:
        if w in pred_lower:
            return 'negative' if not is_negated else 'positive'
    for w in pos_words:
        if w in pred_lower:
            return 'positive' if not is_negated else 'negative'
    return 'neutral'


class TripleExtractor:
    def __init__(self, config: Dict):
        self.config = config
        self.analytics_config = config.get('analytics', {})
        self.triple_config = self.analytics_config.get('triple_extraction', {})
        self.max_triples = self.triple_config.get('max_triples_per_sentence', 5) * 10

        self.nlp = None
        if SPACY_AVAILABLE:
            model_name = self.analytics_config.get('nlp', {}).get('spacy_model', 'en_core_web_sm')
            try:
                self.nlp = spacy.load(model_name)
                logger.info(f"Loaded spaCy model: {model_name}")
            except OSError:
                try:
                    self.nlp = spacy.load('en_core_web_sm')
                except OSError:
                    logger.warning("No spaCy model available, using pattern-based extraction")

        self.negation_cues = {
            'not', "n't", 'no', 'never', 'neither', 'nor', 'none',
            'nothing', 'nowhere', 'hardly', 'barely', 'scarcely',
            'lack', 'lacks', 'lacking', 'missing', 'without', 'fails',
            'failed', 'unable', 'cannot', "can't", "won't", "doesn't",
            "isn't", "aren't", "wasn't", "weren't"
        }

    def extract_all(self, df: pl.DataFrame) -> pl.DataFrame:
        logger.info("Extracting semantic triples from all responses")

        texts = df['raw_text'].to_list()
        brands = df['primary_brand_mention'].to_list() if 'primary_brand_mention' in df.columns else [''] * len(texts)

        if self.nlp and texts:
            valid = [(i, str(t)) for i, t in enumerate(texts) if t and isinstance(t, str) and len(t) > 10]
            spacy_triples_map = {}
            if valid:
                indices, raw_texts = zip(*valid)
                docs = list(self.nlp.pipe(raw_texts, batch_size=256, n_process=1))
                for idx, doc in zip(indices, docs):
                    triples = []
                    for sent in doc.sents:
                        triples.extend(self._extract_dep_triples(sent))
                    spacy_triples_map[idx] = triples

            all_triples = []
            for i, text in enumerate(texts):
                spacy_t = spacy_triples_map.get(i, [])
                pattern_t = self._extract_with_patterns(str(text) if text else '', brands[i] if i < len(brands) else '')
                combined = spacy_t + pattern_t
                seen = set()
                unique = []
                for t in combined:
                    key = (t['subject'].lower(), t['predicate'].lower(), t['object'].lower())
                    if key not in seen:
                        seen.add(key)
                        unique.append(t)
                all_triples.append(unique[:self.max_triples])
        else:
            all_triples = []
            for i, text in enumerate(texts):
                t = self._extract_with_patterns(str(text) if text else '', brands[i] if i < len(brands) else '')
                all_triples.append(t[:self.max_triples])

        df = df.with_columns([pl.Series('extracted_triples', all_triples)])
        self._all_triples = all_triples
        self._entity_triples = defaultdict(list)
        for i, tl in enumerate(all_triples):
            brand = brands[i] if i < len(brands) else ''
            for t in (tl or []):
                self._entity_triples[t['brand']].append(t)
        return df

    def _extract_dep_triples(self, sent) -> List[Dict]:
        triples = []
        for token in sent:
            if token.dep_ in ('nsubj', 'nsubjpass') and token.head.pos_ in ('VERB', 'AUX'):
                subject = ' '.join([t.text for t in token.subtree if t.pos_ != 'PUNCT'])
                predicate = token.head.text
                obj = None
                for child in token.head.children:
                    if child.dep_ in ('dobj', 'attr'):
                        obj = ' '.join([t.text for t in child.subtree if t.pos_ != 'PUNCT'])
                    elif child.dep_ == 'prep':
                        for pobj in child.children:
                            if pobj.dep_ == 'pobj':
                                obj = f"{child.text} {' '.join([t.text for t in pobj.subtree if t.pos_ != 'PUNCT'])}"
                if subject and predicate and obj:
                    is_negated = any(c.dep_ == 'neg' for c in token.head.children)
                    triples.append({
                        'subject': subject.strip(), 'predicate': predicate.strip(),
                        'object': obj.strip(), 'sentiment': _classify_sentiment(predicate, is_negated),
                        'is_negated': is_negated, 'brand': _match_brand(subject),
                        'confidence': 0.85, 'source': 'dependency_parsing',
                        'sentence': sent.text
                    })
        return triples

    def _extract_with_patterns(self, text: str, brand_hint: str) -> List[Dict]:
        if not text:
            return []
        triples = []
        sentences = re.split(r'[.!?]+', text)

        for sent in sentences:
            sent = sent.strip()
            if not sent or len(sent) < 10:
                continue
            for pattern, sentiment in VERB_PATTERNS:
                for match in pattern.finditer(sent):
                    subject = match.group(1).strip()
                    predicate = match.group(2).strip()
                    obj = match.group(3).strip()
                    if len(subject) < 3 or len(obj) < 2:
                        continue
                    triples.append({
                        'subject': subject, 'predicate': predicate, 'object': obj,
                        'sentiment': sentiment, 'is_negated': sentiment == 'negative',
                        'brand': _match_brand(subject, brand_hint),
                        'confidence': 0.7, 'source': 'pattern_matching', 'sentence': sent
                    })

        for pattern, comp_type in COMPARATIVE_PATTERNS:
            for match in pattern.finditer(text):
                entity1 = match.group(1).strip()
                entity2 = match.group(2).strip() if match.lastindex >= 2 else ''
                brand = _match_brand(entity1, brand_hint) or _match_brand(entity2, brand_hint)
                triples.append({
                    'subject': entity1, 'predicate': f'compared_to_{comp_type}',
                    'object': entity2, 'sentiment': 'comparative', 'is_negated': False,
                    'brand': brand, 'confidence': 0.75, 'source': 'comparative_pattern',
                    'sentence': text[max(0, match.start()-50):min(len(text), match.end()+50)]
                })
        return triples

    def get_stats(self, df: pl.DataFrame) -> Dict:
        stats = {
            'total_triples_extracted': 0, 'unique_triples': 0,
            'triples_by_brand': {}, 'sentiment_distribution': {},
            'negative_triples_brand_a': [], 'positive_triples_brand_a': [],
            'top_predicates': [], 'top_objects': [],
            'extraction_method': 'spacy' if self.nlp else 'pattern'
        }
        all_triples = []
        for triple_list in df['extracted_triples'].to_list():
            if triple_list and isinstance(triple_list, list):
                all_triples.extend(triple_list)

        stats['total_triples_extracted'] = len(all_triples)
        unique_triples = set()
        brand_triples = defaultdict(list)
        sentiment_counts = Counter()
        predicates = Counter()
        objects = Counter()

        for triple in all_triples:
            if not isinstance(triple, dict):
                continue
            key = (triple.get('subject', ''), triple.get('predicate', ''), triple.get('object', ''))
            unique_triples.add(key)
            brand_triples[triple.get('brand', 'Unknown')].append(triple)
            sentiment_counts[triple.get('sentiment', 'neutral')] += 1
            predicates[triple.get('predicate', '')] += 1
            objects[triple.get('object', '')] += 1

        stats['unique_triples'] = len(unique_triples)
        stats['sentiment_distribution'] = dict(sentiment_counts)
        stats['top_predicates'] = predicates.most_common(20)
        stats['top_objects'] = objects.most_common(20)

        for brand, triples in brand_triples.items():
            stats['triples_by_brand'][brand] = {
                'count': len(triples),
                'positive': sum(1 for t in triples if t.get('sentiment') == 'positive'),
                'negative': sum(1 for t in triples if t.get('sentiment') == 'negative'),
                'neutral': sum(1 for t in triples if t.get('sentiment') == 'neutral'),
                'comparative': sum(1 for t in triples if t.get('sentiment') == 'comparative')
            }

        brand_a_triples = brand_triples.get('Brand_A', [])
        stats['negative_triples_brand_a'] = [
            {'subject': t['subject'], 'predicate': t['predicate'], 'object': t['object'], 'sentence': t.get('sentence', '')[:200]}
            for t in brand_a_triples if t.get('sentiment') == 'negative'
        ][:10]
        stats['positive_triples_brand_a'] = [
            {'subject': t['subject'], 'predicate': t['predicate'], 'object': t['object'], 'sentence': t.get('sentence', '')[:200]}
            for t in brand_a_triples if t.get('sentiment') == 'positive'
        ][:10]
        return stats
