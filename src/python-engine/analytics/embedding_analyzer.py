"""
Embedding & Semantic Vector Analyzer
Computes cosine similarity between brand content and LLM-generated answers
using sentence-transformers to detect Semantic Vector Drift.
Optimized: smaller samples, batched encoding, reduced UMAP complexity.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from collections import defaultdict

import numpy as np
import polars as pl

logger = logging.getLogger(__name__)

try:
    from sentence_transformers import SentenceTransformer
    from sklearn.metrics.pairwise import cosine_similarity
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    logger.warning("sentence-transformers not available, using numpy fallback")


class EmbeddingAnalyzer:
    def __init__(self, config: Dict):
        self.config = config
        self.embedding_config = config.get('analytics', {}).get('embedding', {})
        self.model_name = self.embedding_config.get('model', 'all-MiniLM-L6-v2')
        self.batch_size = self.embedding_config.get('batch_size', 128)
        self.similarity_threshold = self.embedding_config.get('similarity_threshold', 0.3)
        self.normalize = self.embedding_config.get('normalize', True)

        self.model = None
        self.model_loaded = False
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            candidates = [self.model_name]
            fallback = 'all-MiniLM-L6-v2'
            if self.model_name != fallback:
                candidates.append(fallback)
            for candidate in candidates:
                try:
                    self.model = SentenceTransformer(candidate)
                    self.model_name = candidate
                    self.model_loaded = True
                    logger.info(f"Loaded embedding model: {candidate}")
                    break
                except Exception as e:
                    logger.warning(f"Failed to load embedding model {candidate}: {e}")
        if not self.model_loaded:
            logger.warning("No embedding model available; semantic drift/clustering will be skipped")

    def analyze(self, df: pl.DataFrame) -> Dict:
        results = {
            'model_used': self.model_name,
            'model_loaded': self.model is not None,
            'total_responses_analyzed': 0,
            'brand_vector_profiles': {},
            'semantic_drift': [],
            'cross_model_similarity': {},
            'embedding_clusters': [],
            'topic_embeddings': {}
        }

        successful_df = df.filter(pl.col('success') == True)
        if successful_df.height == 0:
            logger.warning("No successful responses to analyze")
            return results

        results['total_responses_analyzed'] = successful_df.height
        brand_texts = self._aggregate_texts_by_brand(successful_df)
        if not brand_texts:
            return results

        if self.model:
            logger.info("Bulk encoding all texts for embedding analysis...")
            all_texts_map, bulk_texts = self._collect_all_texts(successful_df, brand_texts)
            bulk_embeddings = self.model.encode(bulk_texts, batch_size=self.batch_size,
                                               show_progress_bar=False,
                                               normalize_embeddings=self.normalize)
            offset = 0
            for key in all_texts_map:
                count = all_texts_map[key]['count']
                all_texts_map[key]['embeddings'] = bulk_embeddings[offset:offset+count]
                offset += count

            results['brand_vector_profiles'] = self._compute_brand_profiles(brand_texts, all_texts_map)
            results['semantic_drift'] = self._detect_semantic_drift(results['brand_vector_profiles'])
            results['cross_model_similarity'] = self._compute_cross_model_similarity_bulk(successful_df, all_texts_map)
            results['topic_embeddings'] = self._compute_topic_embeddings_bulk(successful_df, all_texts_map)
            results['embedding_clusters'] = self._cluster_responses_bulk(successful_df, all_texts_map)

        results['text_statistics'] = self._compute_text_statistics(successful_df)
        return results

    def _collect_all_texts(self, df: pl.DataFrame, brand_texts: Dict) -> tuple:
        all_texts_map = {}
        bulk_texts = []

        for brand, texts in brand_texts.items():
            chunks = []
            for t in texts[:30]:
                chunks.extend(self._chunk_text(t, 512))
            chunks = chunks[:20]
            all_texts_map[f'brand:{brand}'] = {'offset': len(bulk_texts), 'count': len(chunks)}
            bulk_texts.extend(chunks)

        model_groups = defaultdict(list)
        try:
            pairs = df.select(['model_id', 'raw_text']).filter(
                pl.col('model_id').is_not_null() & pl.col('raw_text').is_not_null()
            ).to_dicts()
        except Exception:
            pairs = []
            for row in df.iter_rows(named=True):
                m = row.get('model_id', '')
                t = row.get('raw_text', '')
                if m and t and isinstance(t, str):
                    pairs.append({'model_id': m, 'raw_text': t})
        for p in pairs:
            model_groups[p['model_id']].append(p['raw_text'][:2000])
        for mid, texts in model_groups.items():
            sample = texts[:15]
            all_texts_map[f'model:{mid}'] = {'offset': len(bulk_texts), 'count': len(sample)}
            bulk_texts.extend(sample)

        topic_groups = defaultdict(list)
        try:
            pairs2 = df.select(['turn_type', 'raw_text']).filter(
                pl.col('turn_type').is_not_null() & pl.col('raw_text').is_not_null()
            ).to_dicts()
        except Exception:
            pairs2 = []
            for row in df.iter_rows(named=True):
                tt = row.get('turn_type', '')
                tx = row.get('raw_text', '')
                if tt and tx and isinstance(tx, str):
                    pairs2.append({'turn_type': tt, 'raw_text': tx})
        for p in pairs2:
            topic_groups[p['turn_type']].append(p['raw_text'][:1000])
        for topic, texts in topic_groups.items():
            sample = texts[:20]
            all_texts_map[f'topic:{topic}'] = {'offset': len(bulk_texts), 'count': len(sample)}
            bulk_texts.extend(sample)

        cluster_texts = []
        try:
            rows = df.select(['raw_text', 'model_id', 'primary_brand_mention', 'turn_type']).filter(
                pl.col('raw_text').is_not_null() & (pl.col('raw_text').str.len_chars() > 50)
            ).to_dicts()
        except Exception:
            rows = []
            for row in df.iter_rows(named=True):
                t = row.get('raw_text', '')
                if t and isinstance(t, str) and len(t) > 50:
                    rows.append({'raw_text': t, 'model_id': row.get('model_id', ''),
                                 'primary_brand_mention': row.get('primary_brand_mention', ''),
                                 'turn_type': row.get('turn_type', '')})
        sample_size = min(150, len(rows))
        all_texts_map['cluster'] = {
            'offset': len(bulk_texts), 'count': sample_size,
            'metadata': [{'model_id': r['model_id'], 'brand': r['primary_brand_mention'], 'turn_type': r['turn_type']} for r in rows[:sample_size]]
        }
        for r in rows[:sample_size]:
            bulk_texts.append(r['raw_text'][:1000])

        logger.info(f"Bulk encoding {len(bulk_texts)} texts in one pass")
        return all_texts_map, bulk_texts

    def _aggregate_texts_by_brand(self, df: pl.DataFrame) -> Dict[str, List[str]]:
        brand_texts = defaultdict(list)
        try:
            pairs = df.select([
                pl.col('primary_brand_mention').alias('brand'),
                pl.col('raw_text').alias('text')
            ]).filter(
                pl.col('brand').is_not_null() &
                pl.col('text').is_not_null() &
                (pl.col('text').str.len_chars() > 20)
            ).to_dicts()
        except Exception:
            pairs = []
            for row in df.iter_rows(named=True):
                brand = row.get('primary_brand_mention', '')
                text = row.get('raw_text', '')
                if brand and text and isinstance(text, str) and len(text) > 20:
                    pairs.append({'brand': brand, 'text': text})

        for p in pairs:
            brand_texts[p['brand']].append(p['text'][:2000])
        for brand in brand_texts:
            if len(brand_texts[brand]) > 100:
                brand_texts[brand] = brand_texts[brand][:100]
        return dict(brand_texts)

    def _compute_brand_profiles(self, brand_texts: Dict[str, List[str]], all_texts_map: Dict = None) -> Dict:
        profiles = {}
        for brand in brand_texts:
            if all_texts_map and f'brand:{brand}' in all_texts_map:
                info = all_texts_map[f'brand:{brand}']
                embeddings = info['embeddings']
            else:
                continue
            if len(embeddings) == 0:
                continue
            mean_embedding = np.mean(embeddings, axis=0)
            std_embedding = np.std(embeddings, axis=0)
            centroid_similarity = cosine_similarity(mean_embedding.reshape(1, -1), embeddings)[0]
            profiles[brand] = {
                'centroid': mean_embedding.tolist(),
                'std': std_embedding.tolist(),
                'num_chunks': len(embeddings),
                'mean_intra_similarity': float(np.mean(centroid_similarity)),
                'std_intra_similarity': float(np.std(centroid_similarity)),
                'embedding_shape': list(embeddings.shape)
            }
        return profiles

    def _detect_semantic_drift(self, brand_profiles: Dict) -> List[Dict]:
        drifts = []
        entity_config = self.config.get('entity_maps', {}).get('entity_maps', {})
        primary_brand = entity_config.get('your_brand', {}).get('primary_name', '')
        if not primary_brand or primary_brand not in brand_profiles:
            return drifts
        brand_a_centroid = np.array(brand_profiles[primary_brand]['centroid']).reshape(1, -1)
        for brand, profile in brand_profiles.items():
            if brand == primary_brand:
                continue
            other_centroid = np.array(profile['centroid']).reshape(1, -1)
            similarity = float(cosine_similarity(brand_a_centroid, other_centroid)[0][0])
            drift_score = 1.0 - similarity
            if drift_score > self.similarity_threshold:
                drifts.append({
                    'primary_brand_vs': brand, 'cosine_similarity': similarity,
                    'drift_score': drift_score,
                    'interpretation': self._interpret_drift(similarity),
                    'primary_brand_intra_sim': brand_profiles[primary_brand]['mean_intra_similarity'],
                    'competitor_intra_sim': profile['mean_intra_similarity']
                })
        drifts.sort(key=lambda x: x['drift_score'], reverse=True)
        return drifts

    def _interpret_drift(self, similarity: float) -> str:
        if similarity > 0.85:
            return "High semantic overlap - LLMs treat both brands similarly"
        elif similarity > 0.7:
            return "Moderate overlap - some shared semantic territory"
        elif similarity > 0.5:
            return "Significant drift - LLMs associate different attributes"
        elif similarity > 0.3:
            return "Major drift - very different semantic profiles in LLM responses"
        else:
            return "Extreme drift - LLMs describe these brands in completely different contexts"

    def _compute_cross_model_similarity_bulk(self, df: pl.DataFrame, all_texts_map: Dict) -> Dict:
        results = {}
        model_centroids = {}
        for key, info in all_texts_map.items():
            if key.startswith('model:'):
                model_id = key.split(':', 1)[1]
                embs = info['embeddings']
                if len(embs) > 0:
                    model_centroids[model_id] = np.mean(embs, axis=0)
        models = list(model_centroids.keys())
        for i, m1 in enumerate(models):
            for m2 in models[i+1:]:
                sim = float(cosine_similarity(model_centroids[m1].reshape(1, -1), model_centroids[m2].reshape(1, -1))[0][0])
                results[f"{m1}_vs_{m2}"] = {
                    'cosine_similarity': sim,
                    'interpretation': 'High agreement' if sim > 0.8 else 'Moderate agreement' if sim > 0.6 else 'Low agreement - models differ significantly'
                }
        return results

    def _compute_topic_embeddings_bulk(self, df: pl.DataFrame, all_texts_map: Dict) -> Dict:
        topic_embeddings = {}
        for key, info in all_texts_map.items():
            if key.startswith('topic:'):
                topic = key.split(':', 1)[1]
                embs = info['embeddings']
                if len(embs) > 0:
                    topic_embeddings[topic] = {
                        'centroid': np.mean(embs, axis=0).tolist(),
                        'num_samples': len(embs),
                        'intra_similarity': float(np.mean(cosine_similarity(embs)))
                    }
        return topic_embeddings

    def _cluster_responses_bulk(self, df: pl.DataFrame, all_texts_map: Dict) -> List[Dict]:
        info = all_texts_map.get('cluster')
        if not info or info['count'] == 0:
            return []
        embeddings = info['embeddings']
        metadata = info.get('metadata', [])
        sample_size = len(embeddings)
        # HDBSCAN requires at least min_samples + 1 points; UMAP needs >= n_neighbors
        if sample_size < 5:
            return []
        try:
            from umap import UMAP
            n_neighbors = min(10, max(2, sample_size - 1))
            reducer = UMAP(n_components=2, random_state=42, n_neighbors=n_neighbors, min_dist=0.3)
            reduced = reducer.fit_transform(embeddings)
            try:
                from hdbscan import HDBSCAN
                min_cluster = max(2, min(8, sample_size // 2))
                clusterer = HDBSCAN(min_cluster_size=min_cluster, min_samples=3)
                labels = clusterer.fit_predict(embeddings)
            except ImportError:
                labels = np.zeros(sample_size)
            clusters = []
            for i, (emb, label, meta) in enumerate(zip(reduced, labels, metadata)):
                clusters.append({
                    'index': i, 'umap_x': float(emb[0]), 'umap_y': float(emb[1]),
                    'cluster': int(label), 'model_id': meta.get('model_id', ''),
                    'brand': meta.get('brand', ''), 'turn_type': meta.get('turn_type', '')
                })
            return clusters
        except ImportError:
            return []

    def _compute_text_statistics(self, df: pl.DataFrame) -> Dict:
        stats = {
            'total_responses': df.height,
            'avg_response_length': 0,
            'responses_by_model': {},
            'responses_by_turn': {},
            'length_distribution': {}
        }
        try:
            text_lengths = df.select([
                pl.col('raw_text').str.len_chars().alias('len'),
                pl.col('model_id'),
                pl.col('turn_type')
            ]).with_columns(
                pl.when(pl.col('len').is_null()).then(0).otherwise(pl.col('len')).alias('len')
            )
            lengths = text_lengths['len'].to_list()
            if lengths:
                arr = np.array(lengths, dtype=float)
                stats['avg_response_length'] = float(np.mean(arr))
                stats['median_response_length'] = float(np.median(arr))
                stats['std_response_length'] = float(np.std(arr))
                pct = np.percentile(arr, [10, 25, 50, 75, 90])
                stats['length_distribution'] = {
                    'p10': float(pct[0]), 'p25': float(pct[1]),
                    'p50': float(pct[2]), 'p75': float(pct[3]), 'p90': float(pct[4])
                }
            model_agg = text_lengths.group_by('model_id').agg([
                pl.col('len').count().alias('count'),
                pl.col('len').mean().alias('avg_length')
            ])
            for row in model_agg.iter_rows(named=True):
                mid = row['model_id']
                if mid:
                    stats['responses_by_model'][mid] = {'count': row['count'], 'avg_length': float(row['avg_length'])}
            turn_agg = text_lengths.group_by('turn_type').agg([
                pl.col('len').count().alias('count'),
                pl.col('len').mean().alias('avg_length')
            ])
            for row in turn_agg.iter_rows(named=True):
                tt = row['turn_type']
                if tt:
                    stats['responses_by_turn'][tt] = {'count': row['count'], 'avg_length': float(row['avg_length'])}
        except Exception:
            pass
        return stats

    def _chunk_text(self, text: str, max_length: int = 512) -> List[str]:
        words = text.split()
        chunks, current_chunk, current_length = [], [], 0
        for word in words:
            if current_length + len(word) > max_length and current_chunk:
                chunks.append(' '.join(current_chunk))
                current_chunk = [word]
                current_length = len(word)
            else:
                current_chunk.append(word)
                current_length += len(word) + 1
        if current_chunk:
            chunks.append(' '.join(current_chunk))
        return chunks if chunks else [text[:max_length]]

    def save(self, results: Dict, output_dir: Path):
        embeddings_dir = output_dir / 'embeddings'
        embeddings_dir.mkdir(exist_ok=True)
        saveable = {k: v for k, v in results.items() if k != 'model_used' or isinstance(v, str)}
        for key, value in saveable.items():
            if isinstance(value, dict):
                with open(embeddings_dir / f'{key}.json', 'w') as f:
                    json.dump(value, f, indent=2, default=str)
        if results.get('embedding_clusters'):
            with open(embeddings_dir / 'response_clusters.json', 'w') as f:
                json.dump(results['embedding_clusters'], f, indent=2)
        logger.info(f"Saved embedding analysis to {embeddings_dir}")
