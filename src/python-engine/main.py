"""
AEO & LLM Citation Graph Simulator - Main Python Analytics Engine
Orchestrates the full analysis pipeline: attribution, triple extraction,
graph construction, embedding analysis, and report generation.
"""

import json
import os
import sys
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any

import polars as pl

from pipeline.attribution_split import AttributionClassifier
from pipeline.triple_extractor import TripleExtractor
from analytics.citation_graph import CitationGraphBuilder
from analytics.embedding_analyzer import EmbeddingAnalyzer
from analytics.sentiment_matrix import SentimentMatrix
from analytics.share_of_voice import ShareOfVoiceCalculator
from dashboard.generate import DashboardGenerator

_log_dir = Path(__file__).parent.parent.parent / 'logs'
_log_dir.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_log_dir / 'python_engine.log')
    ]
)
logger = logging.getLogger('aeo-python-engine')


class AEOAnalyticsEngine:
    def __init__(self, config_path: str = None):
        self.root_dir = Path(__file__).parent.parent.parent
        self.config = self.load_config(config_path)
        self.output_dir = self.root_dir / 'data' / 'output'
        self.run_id = datetime.now().strftime('%Y%m%d_%H%M%S')

    def load_config(self, config_path: Optional[str] = None) -> Dict:
        config_dir = self.root_dir / 'config'
        config = {}

        for config_file in ['models.json', 'execution.json', 'analytics.json', 'personas.json', 'entity_maps.json']:
            filepath = config_path and Path(config_path) / config_file or config_dir / config_file
            if filepath.exists():
                with open(filepath, 'r') as f:
                    config[config_file.replace('.json', '')] = json.load(f)

        return config

    def load_results(self, run_dir: Optional[str] = None) -> pl.DataFrame:
        if run_dir:
            results_path = Path(run_dir) / 'extracted_data' / 'all_results.json'
        else:
            runs = sorted(self.output_dir.glob('run_*'), reverse=True) if self.output_dir.exists() else []
            if not runs:
                raise FileNotFoundError("No simulation run directories found in data/output/")
            results_path = runs[0] / 'extracted_data' / 'all_results.json'

        if not results_path.exists():
            raise FileNotFoundError(f"Results file not found: {results_path}")

        logger.info(f"Loading results from {results_path}")
        with open(results_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)

        if isinstance(raw_data, dict):
            for key in ['prompts', 'results', 'data', 'records']:
                if key in raw_data and isinstance(raw_data[key], list):
                    raw_data = raw_data[key]
                    break
            else:
                raw_data = [raw_data]

        if not isinstance(raw_data, list):
            raw_data = [raw_data]

        records = []
        for item in raw_data:
            if not isinstance(item, dict):
                continue
            record = {
                'execution_id': item.get('executionId', item.get('execution_id', '')),
                'prompt_session_id': item.get('promptSessionId', item.get('prompt_session_id', '')),
                'persona_id': item.get('personaId', item.get('persona_id', '')),
                'model_id': item.get('modelId', item.get('model_id', '')),
                'turn_index': item.get('turnIndex', item.get('turn_index', 0)),
                'turn_type': item.get('turnType', item.get('turn_type', '')),
                'prompt': item.get('prompt', item.get('query', item.get('text', ''))),
                'rag_enabled': item.get('ragEnabled', item.get('rag_enabled', True)),
                'success': item.get('status', 'fulfilled') in ('fulfilled', 'success', True),
                'raw_text': '',
                'citations': [],
                'entities': [],
                'sentiment': {},
                'triples': [],
                'usage': {},
                'timestamp': item.get('timestamp', '')
            }

            result = item.get('result', item.get('response', item.get('output', {})))
            if isinstance(result, dict):
                record['raw_text'] = result.get('raw_text', result.get('text', result.get('content', '')))
                record['citations'] = result.get('citations', result.get('sources', []))
                record['entities'] = result.get('entities', [])
                record['sentiment'] = result.get('sentiment', {})
                record['triples'] = result.get('triples', [])
                record['usage'] = result.get('usage', {})
                record['citation_count'] = result.get('citationCount', len(result.get('citations', result.get('sources', []))))
            elif isinstance(result, str):
                record['raw_text'] = result
            else:
                record['raw_text'] = str(item.get('prompt', ''))

            records.append(record)

        df = pl.DataFrame(records)
        logger.info(f"Loaded {len(df)} results")
        return df

    def run_full_pipeline(self, run_dir: Optional[str] = None) -> Dict[str, Any]:
        logger.info("=" * 60)
        logger.info("AEO Analytics Pipeline - Starting Full Analysis")
        logger.info("=" * 60)

        results = {}
        output_path = self.output_dir / f'analysis_{self.run_id}'
        output_path.mkdir(parents=True, exist_ok=True)

        import time as _time
        def _emit(stage_num, stage_name):
            import json as _json
            msg = _json.dumps({'stage': stage_name, 'stageNum': stage_num, 'totalStages': 8, 'elapsed': f'{_time.time()-pipeline_start:.0f}s'})
            print(f'__PROGRESS__:{msg}', flush=True)
            logger.info(f'Stage {stage_num}/8: {stage_name}')
        pipeline_start = _time.time()

        try:
            df = self.load_results(run_dir)
            results['total_records'] = len(df)
            results['successful_records'] = df.filter(pl.col('success') == True).height

            _emit(1, 'Attribution Classification (RAG vs Base)')
            t0 = _time.time()
            attr_classifier = AttributionClassifier(self.config)
            df = attr_classifier.classify(df)
            results['attribution_stats'] = attr_classifier.get_stats(df)
            _emit(1, f'Attribution done ({_time.time()-t0:.1f}s)')

            _emit(2, 'Semantic Triple Extraction')
            t0 = _time.time()
            triple_extractor = TripleExtractor(self.config)
            df = triple_extractor.extract_all(df)
            results['triple_stats'] = triple_extractor.get_stats(df)
            _emit(2, f'Triples done ({_time.time()-t0:.1f}s)')

            _emit(3, 'Citation Graph Construction')
            t0 = _time.time()
            graph_builder = CitationGraphBuilder(self.config)
            graphs = graph_builder.build_all_graphs(df)
            results['graph_stats'] = graph_builder.get_stats(graphs)
            graph_builder.save_graphs(graphs, output_path)
            _emit(3, f'Graphs done ({_time.time()-t0:.1f}s)')

            _emit(4, 'Share of Model Voice (SoMV)')
            t0 = _time.time()
            somv_calculator = ShareOfVoiceCalculator(self.config)
            somv = somv_calculator.calculate(df)
            results['somv'] = somv
            somv_calculator.save(somv, output_path)
            _emit(4, f'SoMV done ({_time.time()-t0:.1f}s)')

            _emit(5, 'Embedding & Semantic Vector Analysis')
            t0 = _time.time()
            embedding_analyzer = EmbeddingAnalyzer(self.config)
            embedding_results = embedding_analyzer.analyze(df)
            results['embedding_analysis'] = embedding_results
            embedding_analyzer.save(embedding_results, output_path)
            _emit(5, f'Embeddings done ({_time.time()-t0:.1f}s)')

            _emit(6, 'Sentiment & Hallucination Matrix')
            t0 = _time.time()
            sentiment_matrix = SentimentMatrix(self.config)
            sentiment_results = sentiment_matrix.analyze(df)
            results['sentiment_matrix'] = sentiment_results
            sentiment_matrix.save(sentiment_results, output_path)
            _emit(6, f'Sentiment done ({_time.time()-t0:.1f}s)')

            _emit(7, 'Generating Dashboard')
            t0 = _time.time()
            dashboard_gen = DashboardGenerator(self.config)
            dashboard_path = dashboard_gen.generate(results, output_path)
            results['dashboard_path'] = str(dashboard_path)
            _emit(7, f'Dashboard done ({_time.time()-t0:.1f}s)')

            _emit(8, 'Generating Actionable Recommendations')
            t0 = _time.time()
            recommendations = self.generate_recommendations(results)
            results['recommendations'] = recommendations
            _emit(8, f'Recommendations done ({_time.time()-t0:.1f}s)')

            summary_path = output_path / 'pipeline_summary.json'
            with open(summary_path, 'w') as f:
                json.dump(results, f, indent=2, default=str)
            results['summary_path'] = str(summary_path)

            logger.info("=" * 60)
            logger.info("Pipeline Complete")
            logger.info(f"Output directory: {output_path}")
            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"Pipeline error: {e}", exc_info=True)
            results['error'] = str(e)
            raise

        return results

    def generate_recommendations(self, results: Dict) -> List[Dict]:
        """Generate deep, data-driven recommendations from ALL analysis modules."""
        recommendations = []

        # ─── MODULE 1: Share of Model Voice (SoMV) ───
        somv = results.get('somv', {})
        overall = somv.get('overall', {})
        overall_brands = overall.get('brand_stats', {})
        your_overall = overall_brands.get('Brand_A', {})
        your_sov = your_overall.get('share_of_voice', 0)
        your_primary = your_overall.get('primary_recommendation_rate', 0)
        your_mention = your_overall.get('mention_rate', 0)
        your_omission = your_overall.get('omission_rate', 0)

        # Model-specific SoMV gaps
        for model_name, model_data in somv.get('by_model', {}).items():
            brand_shares = model_data.get('brand_stats', {})
            your_stats = brand_shares.get('Brand_A', {})
            your_share = your_stats.get('primary_recommendation_rate', 0) if isinstance(your_stats, dict) else 0
            your_mr = your_stats.get('mention_rate', 0) if isinstance(your_stats, dict) else 0

            if your_share < 0.3:
                competitor_leaders = [
                    brand for brand, data in brand_shares.items()
                    if brand != 'Brand_A' and isinstance(data, dict) and data.get('primary_recommendation_rate', 0) > your_share
                ]
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Share of Model Voice',
                    'model': model_name,
                    'finding': f'Brand_A has only {your_share:.1%} primary recommendation rate on {model_name} (vs {your_primary:.1%} overall)',
                    'competitor_leaders': competitor_leaders,
                    'action': f'Investigate why {model_name} favors competitors. Check pre-training data presence and RAG index coverage. Target: raise to >30% primary recommendation rate.',
                    'estimated_impact': 'HIGH'
                })

            # Low mention rate on specific model
            if your_mr < 0.3 and model_data.get('total', 0) > 5:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Model Visibility Gap',
                    'model': model_name,
                    'finding': f'Brand_A mention rate only {your_mr:.1%} on {model_name} ({model_data.get("total", 0)} responses analyzed)',
                    'action': f'Check if {model_name} crawls your domain. Update robots.txt, add structured data, ensure indexability.',
                    'estimated_impact': 'MEDIUM'
                })

        # Overall SoMV health
        if your_sov < 0.15:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Critical Brand Visibility',
                'finding': f'Brand_A overall Share of Voice is critically low at {your_sov:.1%}. Target: >25% for competitive parity.',
                'action': 'Launch comprehensive AEO strategy: schema markup on all key pages, structured FAQ content, Wikipedia/Wikidata updates, PR campaigns for pre-training data.',
                'estimated_impact': 'HIGH'
            })
        elif your_sov < 0.25:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Brand Visibility Improvement',
                'finding': f'Brand_A Share of Voice is {your_sov:.1%} — below the 25% competitive parity threshold.',
                'action': 'Expand content marketing, increase third-party mentions, and optimize for AI search with structured data.',
                'estimated_impact': 'MEDIUM'
            })

        # Omission analysis
        if your_omission > 0.2:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Brand Omission Risk',
                'finding': f'Brand_A is omitted from {your_omission:.1%} of LLM responses. This means 1 in {max(1,round(1/your_omission))} AI searches ignores your brand entirely.',
                'action': 'Audit content for completeness across all buyer personas. Ensure your brand appears in comparison content, industry reports, and expert roundups.',
                'estimated_impact': 'HIGH'
            })

        # RAG vs Base attribution insights
        rag_vs_base = somv.get('rag_vs_base', {})
        attribution_insights = rag_vs_base.get('attribution_insights', [])
        for insight_data in attribution_insights:
            if insight_data.get('brand') == 'Brand_A':
                if insight_data.get('attribution') == 'pretraining_boosted':
                    recommendations.append({
                        'priority': 'HIGH',
                        'category': 'RAG Indexing Gap',
                        'finding': f'Brand_A performs better in base weights (pre-training) than RAG. RAG rate: {insight_data["rag_rate"]:.1%} vs Base rate: {insight_data["base_rate"]:.1%}.',
                        'action': f'RAG index is missing your content. Implement Schema.org (FAQ, Product, TechArticle) on key pages. Ensure static HTML delivery (94% parse success vs 23% JS). Target crawlers: GPTBot, ClaudeBot, PerplexityBot.',
                        'estimated_impact': 'HIGH'
                    })
                else:
                    recommendations.append({
                        'priority': 'MEDIUM',
                        'category': 'Pre-Training Authority Gap',
                        'finding': f'Brand_A performs better in RAG than base weights. RAG rate: {insight_data["rag_rate"]:.1%} vs Base rate: {insight_data["base_rate"]:.1%}.',
                        'action': 'Improve pre-training presence: Wikipedia/Wikidata updates, high-authority media PR, industry analyst briefings, conference speaking.',
                        'estimated_impact': 'HIGH'
                    })

        # Competitive gaps
        for gap in somv.get('competitive_gaps', []):
            if gap.get('gap', 0) > 0.1:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Competitive Threat',
                    'finding': f'{gap["competitor"]} leads Brand_A by {gap["gap"]:.1%} in primary recommendation rate (Their: {gap["competitor_primary_rate"]:.1%} vs Yours: {gap["your_primary_rate"]:.1%})',
                    'action': gap.get('recommendation', f'Investigate why {gap["competitor"]} outperforms and develop counter-strategy.'),
                    'estimated_impact': 'HIGH'
                })

        # Citation depth gaps
        citation_depth = somv.get('citation_depth', {})
        avg_citations = citation_depth.get('avg_citations_per_response', 0)
        zero_citations = citation_depth.get('citation_distribution', {}).get('zero_citations', 0)
        total_responses = results.get('total_records', 1)
        if zero_citations > total_responses * 0.3:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Citation Deficit',
                'finding': f'{zero_citations} responses ({zero_citations/total_responses:.0%}) have zero citations. Average citations per response: {avg_citations:.2f}.',
                'action': 'Create more citation-worthy content: original research, benchmarks, case studies with data. Pages with citations get 3-5x more AI referral traffic.',
                'estimated_impact': 'MEDIUM'
            })

        # ─── MODULE 2: Citation Graph Analysis ───
        graph_stats = results.get('graph_stats', {})

        # Missing authority nodes
        missing_nodes = graph_stats.get('missing_authority_nodes', [])
        if missing_nodes:
            high_weight_missing = [n for n in missing_nodes if n.get('weight', 0) >= 5]
            if high_weight_missing:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Missing Authority Sources',
                    'finding': f'{len(high_weight_missing)} high-weight authority sources cite competitors but not Brand_A (top: {high_weight_missing[0]["domain"]} with weight {high_weight_missing[0]["weight"]})',
                    'action': f'Priority: establish presence on top {min(5, len(high_weight_missing))} missing sources. Create content, engage in discussions, get featured. Each missing node = captured citation volume.',
                    'estimated_impact': 'HIGH'
                })
            for node in missing_nodes[:3]:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Authority Node Gap',
                    'finding': f'{node["domain"]} (weight: {node["weight"]}) cited by {node.get("competitor", "competitor")} but Brand_A absent',
                    'action': f'Create content on {node["domain"]}: guest posts, product listings, documentation, or community engagement.',
                    'estimated_impact': 'MEDIUM'
                })

        # Competitor-dominant sources
        comp_dom = graph_stats.get('competitor_dominant_sources', [])
        if comp_dom:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Competitor Citation Dominance',
                'finding': f'{len(comp_dom)} citation sources dominated by competitors: {", ".join(comp_dom[:5])}',
                'action': 'Increase content presence and brand mentions on these platforms to shift citation share.',
                'estimated_impact': 'MEDIUM'
            })

        # Low-density graphs
        graphs = graph_stats.get('graphs', {})
        for graph_name, graph_data in graphs.items():
            density = graph_data.get('density', 0)
            nodes = graph_data.get('nodes', 0)
            if density < 0.05 and nodes > 10:
                recommendations.append({
                    'priority': 'LOW',
                    'category': 'Citation Network Growth',
                    'finding': f'{graph_name.replace("_", " ").title()} has low density ({density:.4f}) with {nodes} nodes — sparse citation network.',
                    'action': 'Build more cross-references between content pieces. Create hub pages that link to related content.',
                    'estimated_impact': 'LOW'
                })

        # ─── MODULE 3: Triple Extraction ───
        triple_stats = results.get('triple_stats', {})

        # Negative triples (reputation threats)
        neg_triples = triple_stats.get('negative_triples_brand_a', [])
        if neg_triples:
            unique_neg = {}
            for t in neg_triples:
                key = f"{t.get('subject','')}|{t.get('predicate','')}|{t.get('object','')}"
                if key not in unique_neg:
                    unique_neg[key] = t

            recommendations.append({
                'priority': 'HIGH',
                'category': 'Reputation Threat',
                'finding': f'{len(unique_neg)} unique negative claims about Brand_A found across LLM responses ({len(neg_triples)} total occurrences)',
                'action': f'Create targeted FAQ pages for each unique negative claim (~500-1000 words each, ~$50-100/page). A single page can counter a false claim across ALL LLMs.',
                'estimated_impact': 'HIGH'
            })
            for triple in list(unique_neg.values())[:5]:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Negative Claim Counter',
                    'finding': f'"{triple.get("subject", "")} {triple.get("predicate", "")} {triple.get("object", "")}"',
                    'action': f'Create schema-validated documentation addressing this claim. Include evidence, data, and expert quotes.',
                    'estimated_impact': 'MEDIUM'
                })

        # Positive triples (amplification opportunities)
        pos_triples = triple_stats.get('positive_triples_brand_a', [])
        if pos_triples:
            unique_pos = {}
            for t in pos_triples:
                key = f"{t.get('subject','')}|{t.get('predicate','')}|{t.get('object','')}"
                if key not in unique_pos:
                    unique_pos[key] = t
            if unique_pos:
                top_pos = list(unique_pos.values())[:3]
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Positive Amplification',
                    'finding': f'{len(unique_pos)} positive claims about Brand_A found. Top: "{top_pos[0].get("subject", "")} {top_pos[0].get("predicate", "")} {top_pos[0].get("object", "")}"',
                    'action': 'Amplify these positive narratives: create case studies, share on social media, pitch to media outlets, add to marketing materials.',
                    'estimated_impact': 'MEDIUM'
                })

        # Deduplication rate (content consistency signal)
        total_triples = triple_stats.get('total_triples_extracted', 0)
        unique_triples = triple_stats.get('unique_triples', 0)
        if total_triples > 0:
            dedup_rate = (total_triples - unique_triples) / total_triples
            if dedup_rate > 0.7:
                recommendations.append({
                    'priority': 'LOW',
                    'category': 'Content Redundancy',
                    'finding': f'{dedup_rate:.0%} of extracted triples are duplicates — LLMs repeat the same limited information about Brand_A.',
                    'action': 'Diversify content to give LLMs more unique facts to cite: new product features, customer stories, technical deep-dives.',
                    'estimated_impact': 'LOW'
                })

        # ─── MODULE 4: Embedding & Semantic Analysis ───
        embedding = results.get('embedding_analysis', {})

        # Semantic drift
        drift_data = embedding.get('semantic_drift', [])
        for drift in drift_data:
            drift_score = drift.get('drift_score', drift.get('gap', 0))
            if drift_score > 0.1:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Semantic Vector Drift',
                    'finding': f'Cosine similarity gap: {drift_score:.3f} — Brand_A content doesn\'t match what LLMs consider optimal for {drift.get("topic", "this topic")}',
                    'action': f'Restructure content to align with the semantic patterns LLMs expect. Use similar language, structure, and depth as top-ranking competitor content.',
                    'estimated_impact': 'HIGH'
                })

        # Low brand vector consistency
        brand_profiles = embedding.get('brand_vector_profiles', {})
        brand_a_profile = brand_profiles.get('Brand_A', {})
        if brand_a_profile:
            intra_sim = brand_a_profile.get('mean_intra_similarity', 1)
            if intra_sim < 0.6:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Brand Narrative Inconsistency',
                    'finding': f'Brand_A intra-similarity is {intra_sim:.3f} (low consistency across LLMs). LLMs give conflicting descriptions of your brand.',
                    'action': 'Create a unified brand narrative document. Publish canonical content that all LLMs can reference. Ensure consistent messaging across all channels.',
                    'estimated_impact': 'HIGH'
                })

        # Cross-model similarity gaps
        cross_sim = embedding.get('cross_model_similarity', {})
        for pair, data in cross_sim.items():
            sim = data.get('cosine_similarity', 1)
            if sim < 0.85:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Cross-Model Inconsistency',
                    'finding': f'{pair.replace("_vs_", " vs ")}: only {sim:.1%} semantic similarity — very different brand perceptions across models.',
                    'action': 'Investigate model-specific content gaps. Create model-targeted content for the weakest-performing model.',
                    'estimated_impact': 'MEDIUM'
                })

        # Response length analysis
        text_stats = embedding.get('text_statistics', {})
        avg_length = text_stats.get('avg_response_length', 0)
        responses_by_model = text_stats.get('responses_by_model', {})
        if responses_by_model:
            lengths = [(m, d.get('avg_length', 0)) for m, d in responses_by_model.items() if d.get('avg_length')]
            if lengths:
                lengths.sort(key=lambda x: x[1])
                shortest = lengths[0]
                longest = lengths[-1]
                if longest[1] > 0 and shortest[1] > 0:
                    ratio = longest[1] / shortest[1]
                    if ratio > 3:
                        recommendations.append({
                            'priority': 'MEDIUM',
                            'category': 'Response Depth Variance',
                            'finding': f'{longest[0]} generates {ratio:.1f}x longer responses than {shortest[0]} ({longest[1]:.0f} vs {shortest[1]:.0f} chars avg). Longer responses = more citation opportunities.',
                            'action': f'Optimize content for {shortest[0]} to encourage longer, more detailed responses that surface more of your brand.',
                            'estimated_impact': 'MEDIUM'
                        })

        # ─── MODULE 5: Sentiment & Biases ───
        sentiment = results.get('sentiment_matrix', {})
        biases = sentiment.get('detected_biases', [])
        hallucinations = sentiment.get('hallucination_signals', [])

        # HIGH severity biases
        high_biases = [b for b in biases if b.get('severity') == 'HIGH']
        if high_biases:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Critical Bias Patterns',
                'finding': f'{len(high_biases)} HIGH-severity bias patterns detected across LLMs. These actively harm brand perception.',
                'action': f'Immediate remediation for each HIGH bias (estimated ~$2K-5K per bias pattern in content creation). ROI: each resolved HIGH bias prevents ~$50K/month in missed pipeline.',
                'estimated_impact': 'HIGH'
            })
            for bias in high_biases[:5]:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Bias Remediation',
                    'finding': f'{bias.get("brand", "Brand_A")} — {bias.get("pattern_display", bias.get("bias_pattern", ""))} ({bias.get("occurrence_count", 0)} occurrences)',
                    'action': bias.get('remediation', f'Create content countering the {bias.get("bias_pattern", "")} narrative with evidence and data.'),
                    'estimated_impact': 'HIGH'
                })

        # MEDIUM biases
        med_biases = [b for b in biases if b.get('severity') == 'MEDIUM']
        if med_biases:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Moderate Bias Patterns',
                'finding': f'{len(med_biases)} MEDIUM-severity bias patterns. While less critical, these accumulate to damage brand perception over time.',
                'action': 'Address MEDIUM biases in content roadmap. Prioritize biases with highest occurrence counts.',
                'estimated_impact': 'MEDIUM'
            })

        # Hallucination signals
        if hallucinations:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Hallucination Risk',
                'finding': f'{len(hallucinations)} hallucination signals detected — conflicting or unverifiable claims about Brand_A across models.',
                'action': 'Create authoritative documentation to serve as ground truth for LLMs. Publish verified facts, official specs, and canonical data points.',
                'estimated_impact': 'HIGH'
            })
            for hh in hallucinations[:3]:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Hallucination Counter',
                    'finding': f'{hh.get("brand", "Brand_A")} — {hh.get("claim_type", "")} claims conflict across models ({hh.get("occurrence_count", 0)} occurrences)',
                    'action': hh.get('action', 'Verify and publish authoritative claims to resolve conflicting information across models.'),
                    'estimated_impact': 'MEDIUM'
                })

        # Negative sentiment pattern clusters
        neg_patterns = sentiment.get('negative_pattern_clusters', {})
        if neg_patterns:
            top_patterns = sorted(neg_patterns.values(), key=lambda x: x.get('count', 0), reverse=True)[:3]
            for pattern in top_patterns:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Negative Sentiment Pattern',
                    'finding': f'{pattern.get("brand", "Brand_A")} — "{pattern.get("pattern", "")}" pattern ({pattern.get("count", 0)} occurrences across {len(pattern.get("models", []))} models)',
                    'action': f'Create targeted content to counter this specific negative pattern across all models.',
                    'estimated_impact': 'MEDIUM'
                })

        # ─── MODULE 6: Attribution Stats ───
        attr = results.get('attribution_stats', {})
        rag_count = attr.get('rag_enabled_count', 0)
        base_count = attr.get('rag_disabled_count', 0)
        total_responses = attr.get('total_responses', 1)
        rag_pct = (rag_count / total_responses * 100) if total_responses else 0

        if rag_pct < 50:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Low RAG Coverage',
                'finding': f'Only {rag_pct:.0f}% of responses use RAG (web search). {100-rag_pct:.0f}% rely entirely on pre-trained data.',
                'action': 'Ensure your key pages are crawlable by AI bots. Add structured data, improve page load speed, and check robots.txt.',
                'estimated_impact': 'MEDIUM'
            })

        # ─── MODULE 7: Cost & Pipeline Efficiency ───
        total_records = results.get('total_records', 0)
        successful = results.get('successful_records', 0)
        success_rate = (successful / total_records * 100) if total_records else 0

        if success_rate < 90:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Pipeline Reliability',
                'finding': f'Success rate: {success_rate:.1f}% ({successful}/{total_records} records). {total_records - successful} failed records.',
                'action': 'Investigate failure patterns. Common causes: API timeouts, rate limits, content extraction failures. Optimize retry logic.',
                'estimated_impact': 'MEDIUM'
            })

        # Cost estimation
        recommendations.append({
            'priority': 'INFO',
            'category': 'Cost Analysis',
            'finding': f'Pipeline processed {total_records} records across {attr.get("unique_models", 0)} models. Estimated API cost: ${total_records * 0.003:.2f}-{total_records * 0.012:.2f}',
            'action': 'Review per-model cost breakdowns. Optimize by routing simpler prompts to cheaper models and complex queries to premium models.',
            'estimated_impact': 'LOW'
        })

        # ─── CROSS-MODULE INSIGHTS ───
        # Combined negative signal
        if neg_triples and high_biases:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Compound Risk Alert',
                'finding': f'Brand_A faces COMPOUND risk: {len(unique_neg)} negative claims + {len(high_biases)} HIGH-severity biases. Together these create a strongly negative AI perception.',
                'action': 'Emergency content intervention: address top 5 negative claims and remediate HIGH biases simultaneously. Estimated budget: $5K-15K. Expected impact: 20-40% SoMV improvement within 90 days.',
                'estimated_impact': 'HIGH'
            })

        # Missing nodes + omission correlation
        if missing_nodes and your_omission > 0.2:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Visibility Gap Correlation',
                'finding': f'{len(missing_nodes)} missing authority nodes correlate with {your_omission:.0%} omission rate. Absence from key sources directly causes invisibility.',
                'action': f'Prioritize top {min(5, len(missing_nodes))} missing nodes for immediate presence building. Each node captured reduces omission by an estimated 2-5%.',
                'estimated_impact': 'HIGH'
            })

        return sorted(recommendations, key=lambda x: {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2, 'INFO': 3}.get(x['priority'], 4))


def main():
    import argparse
    parser = argparse.ArgumentParser(description='AEO Analytics Engine')
    parser.add_argument('--run-dir', type=str, help='Path to specific run directory')
    parser.add_argument('--config', type=str, help='Path to config directory')
    args = parser.parse_args()

    engine = AEOAnalyticsEngine(config_path=args.config)
    results = engine.run_full_pipeline(run_dir=args.run_dir)

    print("\n" + "=" * 60)
    print("ANALYSIS COMPLETE")
    print("=" * 60)
    print(f"Total records analyzed: {results.get('total_records', 0)}")
    print(f"Recommendations generated: {len(results.get('recommendations', []))}")
    print(f"Summary saved to: {results.get('summary_path', 'N/A')}")
    if results.get('dashboard_path'):
        print(f"Dashboard: {results.get('dashboard_path')}")

    return results


if __name__ == '__main__':
    main()
