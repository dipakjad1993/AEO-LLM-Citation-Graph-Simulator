"""
Ground-Truth Claim Verification
Checks every extracted claim (subject-predicate-object triple) from each LLM
response against an authoritative ground-truth corpus built from:

  1. config/entity_maps.json -> your_brand.attributes (features, pricing,
     certifications, USPs, target segments) -- the brand's own authoritative facts.
  2. Uploaded gold standards (data/uploads/gold_standards/*).
  3. Uploaded corpus documents (data/uploads/corpus/*) -- e.g. scraped brand pages.

Each claim is labelled one of: verified | partially_verified | unverified |
contradicted, with an evidence passage and a numeric confidence. The aggregate
report gives per-model and per-brand veracity so hallucinations and knowledge
gaps are surfaced instead of hidden.

Embeddings (sentence-transformers) are used when available for semantic
matching; a deterministic lexical scorer is the always-available fallback so
the module runs offline and fast.
"""

import json
import logging
import re
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

import polars as pl

logger = logging.getLogger(__name__)

_NEGATORS = re.compile(
    r'\b(not|no|never|doesn\'t|doesnt|don\'t|dont|isn\'t|isnt|aren\'t|arent|'
    r'without|lacks|lacking|missing|has no|have no|cannot|can\'t|cant|unable|fails? to|'
    r'excludes|omits|withdrew|discontinued)\b',
    re.IGNORECASE
)

_VERIFIED_THRESHOLD = 0.72
_PARTIAL_THRESHOLD = 0.42


def _norm_tokens(text: str) -> set:
    return set(re.findall(r'[a-z0-9]{3,}', str(text).lower()))


def _stem_token(token: str) -> str:
    """Light stem for robust lexical matching (certified ~ certification)."""
    if len(token) >= 7:
        return token[:6]
    return token


def _token_stems(text: str) -> set:
    tokens = _norm_tokens(text)
    stems = set(tokens)
    stems.update(_stem_token(t) for t in tokens)
    return stems


def _lexical_similarity(a: str, b: str) -> float:
    """Containment-based lexical similarity (symmetric via the smaller set).

    Defined as |A ∩ B| / min(|A|, |B|) over stemmed tokens, so short
    ground-truth passages ("SOC 2 certified") embedded in a longer claim are
    detected as strong matches, while long claims are not penalised.
    """
    sa = _token_stems(a)
    sb = _token_stems(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / min(len(sa), len(sb))


class _Embedder:
    """Lazy sentence-transformers wrapper with graceful offline fallback."""

    def __init__(self, model_name: str, enabled: bool = True):
        self.model_name = model_name
        self.enabled = enabled
        self._model = None
        self._failed = False

    def _load(self):
        if self._model is not None or self._failed:
            return
        try:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.model_name)
            logger.info(f"Loaded embedding model for claim verification: {self.model_name}")
        except Exception as e:
            self._failed = True
            logger.warning(f"Embedding model unavailable ({e}); using lexical verification only")

    def encode(self, texts: List[str]) -> Optional[List[List[float]]]:
        if not self.enabled or self._failed or not texts:
            return None
        self._load()
        if self._model is None:
            return None
        try:
            return self._model.encode(texts, batch_size=64, show_progress_bar=False).tolist()
        except Exception as e:
            logger.warning(f"Embedding failed: {e}")
            return None


def _cosine(a: List[float], b: List[float]) -> float:
    try:
        import numpy as np
        va, vb = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
        denom = (float(np.linalg.norm(va)) * float(np.linalg.norm(vb)))
        if denom == 0:
            return 0.0
        return float(np.dot(va, vb) / denom)
    except Exception:
        return 0.0


class GroundTruthClaimVerifier:
    def __init__(self, config: Dict, run_dir: Optional[str] = None):
        self.config = config
        self.entity_config = config.get('entity_maps', {}).get('entity_maps', {})
        self.verification_config = config.get('analytics', {}).get('verification', {})
        self.verified_threshold = float(self.verification_config.get('verified_threshold', _VERIFIED_THRESHOLD))
        self.partial_threshold = float(self.verification_config.get('partial_threshold', _PARTIAL_THRESHOLD))
        embed_cfg = self.verification_config.get('embedding', {})
        self.embedder = _Embedder(
            embed_cfg.get('model', 'all-mpnet-base-v2'),
            enabled=self.verification_config.get('use_embeddings', True)
        )
        self.ground_truth: List[Dict[str, Any]] = []
        self._load_ground_truth(run_dir)

    # ── Ground-truth corpus ──────────────────────────────────────────────
    def _load_ground_truth(self, run_dir: Optional[str]) -> None:
        sources = []

        attrs = (self.entity_config.get('your_brand') or {}).get('attributes', {}) or {}
        attr_passages = []
        for key, label in [
            ('features', 'feature'),
            ('pricing_model', 'pricing model'),
            ('target_segment', 'target segment'),
            ('certifications', 'certification'),
            ('unique_selling_points', 'USP'),
            ('category', 'category')
        ]:
            value = attrs.get(key)
            if value is None:
                continue
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and item.strip():
                        attr_passages.append((item.strip(), f"entity_maps.attributes.{key}"))
            elif isinstance(value, str) and value.strip():
                attr_passages.append((value.strip(), f"entity_maps.attributes.{key}"))
        for text, source in attr_passages:
            self.ground_truth.append({
                'text': text,
                'source': source,
                'domain': 'brand_ground_truth'
            })
            sources.append(source)

        for competitor in self.entity_config.get('competitors', []):
            comp_attrs = competitor.get('attributes', {}) or {}
            for key in ['features', 'pricing_model', 'unique_selling_points']:
                value = comp_attrs.get(key)
                if isinstance(value, list):
                    for item in value:
                        if isinstance(item, str) and item.strip():
                            self.ground_truth.append({
                                'text': item.strip(),
                                'source': f"entity_maps.competitors.{competitor.get('primary_name')}.{key}",
                                'domain': 'brand_ground_truth',
                                'brand': competitor.get('primary_name')
                            })
                            sources.append(f"entity_maps.competitors.{competitor.get('primary_name')}.{key}")

        self._load_uploaded(run_dir, sources)

        logger.info(f"Ground-truth corpus: {len(self.ground_truth)} passage(s) from {len(set(sources))} source(s)")

    def _load_uploaded(self, run_dir: Optional[str], sources: List[str]) -> None:
        if not run_dir:
            return
        base = Path(run_dir)
        for section, section_source in [('uploaded_gold_standards', 'gold_standard'),
                                        ('uploaded_corpus', 'corpus')]:
            section_dir = base / section
            if not section_dir.exists():
                continue
            for file in sorted(section_dir.iterdir()):
                if not file.is_file():
                    continue
                try:
                    content = file.read_text(encoding='utf-8', errors='ignore')
                except Exception:
                    continue
                text_chunks = self._chunk_text(content)
                for chunk in text_chunks:
                    self.ground_truth.append({
                        'text': chunk,
                        'source': f"{section_source}:{file.name}",
                        'domain': 'uploaded'
                    })
                    sources.append(f"{section_source}:{file.name}")

    @staticmethod
    def _chunk_text(content: str, chunk_size: int = 1200, overlap: int = 150) -> List[str]:
        if content.startswith('[') or content.startswith('{'):
            try:
                data = json.loads(content)
                if isinstance(data, dict):
                    text = json.dumps(data, indent=2)
                else:
                    text = ' '.join(str(x) if isinstance(x, str) else json.dumps(x) for x in data)
                content = text
            except Exception:
                pass
        content = re.sub(r'\s+', ' ', content).strip()
        if len(content) <= chunk_size:
            return [content] if content else []
        chunks = []
        start = 0
        while start < len(content):
            end = min(start + chunk_size, len(content))
            if end < len(content):
                nxt = content.rfind(' ', start + int(chunk_size * 0.7), end)
                if nxt > start:
                    end = nxt
            chunks.append(content[start:end].strip())
            start = max(end - overlap, start + 1)
        return [c for c in chunks if c]

    # ── Claim verification ───────────────────────────────────────────────
    def verify(self, df: pl.DataFrame) -> Tuple[pl.DataFrame, Dict]:
        logger.info("Verifying extracted claims against ground-truth corpus")

        claims, row_indices, has_triples = self._collect_claims(df)

        if not self.ground_truth:
            logger.warning("No ground-truth corpus available - all claims reported as UNVERIFIED")
            result_map = {c['triple_index']: {
                'label': 'unverified',
                'confidence': 0.0,
                'reason': 'no_ground_truth',
                'evidence': None,
                'evidence_source': None
            } for c in claims}
            report = self._build_report(df, claims, result_map, has_triples, verified_run=False)
            df = self._attach(df, claims, result_map)
            return df, report

        gt_texts = [gt['text'] for gt in self.ground_truth]

        claim_texts = [c['claim_text'] for c in claims]
        claim_embeds = self.embedder.encode(claim_texts) if claim_texts else None
        gt_embeds = self.embedder.encode(gt_texts) if claim_texts else None
        use_embeddings = claim_embeds is not None and gt_embeds is not None

        result_map = {}
        for idx, claim in enumerate(claims):
            result_map[claim['triple_index']] = self._verify_claim(
                claim, gt_texts, claim_embeds[idx] if use_embeddings else None,
                gt_embeds if use_embeddings else None
            )

        report = self._build_report(df, claims, result_map, has_triples, verified_run=True)
        df = self._attach(df, claims, result_map)
        return df, report

    def _collect_claims(self, df: pl.DataFrame) -> Tuple[List[Dict], List[int], bool]:
        claims = []
        triple_indices = []
        has_triples = False
        triples_col = 'extracted_triples' if 'extracted_triples' in df.columns else ('triples' if 'triples' in df.columns else None)
        if triples_col is None:
            return claims, triple_indices, has_triples

        rows = df.select(['model_id', 'persona_id', 'primary_brand_mention', triples_col]).iter_rows(named=True)
        for row_idx, row in enumerate(rows):
            triples = row.get(triples_col) or []
            if not isinstance(triples, list) or not triples:
                continue
            has_triples = True
            for triple in triples:
                if not isinstance(triple, dict):
                    continue
                subject = str(triple.get('subject', '') or '').strip()
                predicate = str(triple.get('predicate', '') or '').strip()
                obj = str(triple.get('object', '') or '').strip()
                if not (subject and predicate and obj):
                    continue
                claim_text = f"{subject} {predicate} {obj}"
                claim_hash = hashlib.sha256(claim_text.lower().encode()).hexdigest()
                claims.append({
                    'claim_text': claim_text,
                    'subject': subject,
                    'predicate': predicate,
                    'object': obj,
                    'triple_index': len(claims),
                    'brand': triple.get('brand') or row.get('primary_brand_mention') or '',
                    'model_id': row.get('model_id'),
                    'persona_id': row.get('persona_id'),
                    'row_index': row_idx,
                    'claim_hash': claim_hash
                })
                triple_indices.append(row_idx)
        return claims, triple_indices, has_triples

    def _verify_claim(self, claim: Dict, gt_texts: List[str],
                      claim_embed: Optional[List[float]],
                      gt_embeds: Optional[List[List[float]]]) -> Dict:
        best_score = 0.0
        best_gt_idx = -1

        for i, gt_text in enumerate(gt_texts):
            gt_len = len(_norm_tokens(gt_text))
            if gt_len < 2:
                # A single-token passage ("cloud") is too ambiguous to assert.
                continue
            score = _lexical_similarity(claim['claim_text'], gt_text)
            if claim_embed is not None and gt_embeds is not None:
                sem = _cosine(claim_embed, gt_embeds[i])
                score = max(score, sem)
            if score > best_score:
                best_score = score
                best_gt_idx = i

        claim_lower = claim['claim_text'].lower()
        has_negator = bool(_NEGATORS.search(claim_lower))

        if best_gt_idx < 0 or best_score < self.partial_threshold:
            return {
                'label': 'unverified',
                'confidence': round(best_score, 4),
                'reason': 'no_supporting_ground_truth',
                'evidence': None,
                'evidence_source': None
            }

        gt = self.ground_truth[best_gt_idx]

        if has_negator and best_score >= self.partial_threshold:
            # Claim denies something the ground truth asserts as fact.
            return {
                'label': 'contradicted',
                'confidence': round(min(1.0, best_score + 0.1), 4),
                'reason': 'negated_claim_vs_asserted_ground_truth',
                'evidence': gt['text'],
                'evidence_source': gt['source'],
                'similarity': round(best_score, 4)
            }

        if best_score >= self.verified_threshold:
            label = 'verified'
        elif best_score >= self.partial_threshold:
            label = 'partially_verified'
        else:
            label = 'unverified'

        return {
            'label': label,
            'confidence': round(best_score, 4),
            'reason': f'match_{label}',
            'evidence': gt['text'],
            'evidence_source': gt['source'],
            'similarity': round(best_score, 4)
        }

    def _attach(self, df: pl.DataFrame, claims: List[Dict], result_map: Dict) -> pl.DataFrame:
        if 'claim_verification' in df.columns:
            df = df.drop('claim_verification')
        if 'verified_claim_count' in df.columns:
            df = df.drop('verified_claim_count')
        per_row = {}
        for claim in claims:
            res = result_map[claim['triple_index']]
            per_row.setdefault(claim['row_index'], []).append(res)
        verifications = []
        verified_counts = []
        for row_idx in range(df.height):
            row_claims = per_row.get(row_idx, [])
            verifications.append(row_claims)
            verified_counts.append(sum(1 for c in row_claims if c['label'] in ('verified', 'partially_verified')))
        df = df.with_columns([
            pl.Series('claim_verification', verifications),
            pl.Series('verified_claim_count', verified_counts)
        ])
        return df

    def _build_report(self, df: pl.DataFrame, claims: List[Dict], result_map: Dict,
                      has_triples: bool, verified_run: bool) -> Dict:
        def _agg(sub_claims):
            counts = {'verified': 0, 'partially_verified': 0, 'unverified': 0, 'contradicted': 0}
            for c in sub_claims:
                res = result_map[c['triple_index']]
                counts[res['label']] = counts.get(res['label'], 0) + 1
            total = sum(counts.values())
            return {
                'total_claims': total,
                **counts,
                'verified_rate': round((counts['verified'] + counts['partially_verified']) / total, 4) if total else 0.0,
                'contradiction_rate': round(counts['contradicted'] / total, 4) if total else 0.0
            }

        overall = _agg(claims)

        by_model = {}
        for c in claims:
            key = c['model_id'] or 'unknown'
            by_model.setdefault(key, []).append(c)
        by_model_stats = {k: _agg(v) for k, v in by_model.items()}

        by_brand = {}
        for c in claims:
            key = c['brand'] or 'unknown'
            by_brand.setdefault(key, []).append(c)
        by_brand_stats = {k: _agg(v) for k, v in by_brand.items()}

        contradicted_claims = []
        unverified_claims = []
        for c in claims:
            res = result_map[c['triple_index']]
            item = {
                'claim': c['claim_text'],
                'brand': c['brand'],
                'model_id': c['model_id'],
                'persona_id': c['persona_id'],
                'confidence': res['confidence'],
                'reason': res.get('reason'),
                'evidence': res.get('evidence'),
                'evidence_source': res.get('evidence_source')
            }
            if res['label'] == 'contradicted':
                contradicted_claims.append(item)
            elif res['label'] == 'unverified':
                unverified_claims.append(item)

        report = {
            'verification_ran': verified_run,
            'ground_truth': {
                'passage_count': len(self.ground_truth),
                'sources': sorted({gt['source'] for gt in self.ground_truth})
            },
            'claims_extracted': len(claims),
            'has_triples': has_triples,
            'overall': overall,
            'by_model': by_model_stats,
            'by_brand': by_brand_stats,
            'contradicted_claims': contradicted_claims[:50],
            'unverified_claims': unverified_claims[:50]
        }
        if not verified_run:
            report['message'] = 'No ground-truth corpus was available; all claims are reported UNVERIFIED. ' \
                                'Upload gold standards or add your brand attributes in entity_maps.json.'
        return report

    def save(self, report: Dict, output_dir: Path):
        reports_dir = output_dir / 'reports'
        reports_dir.mkdir(exist_ok=True)
        with open(reports_dir / 'claim_verification.json', 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, default=str)
        logger.info(f"Saved claim verification report to {reports_dir}")
