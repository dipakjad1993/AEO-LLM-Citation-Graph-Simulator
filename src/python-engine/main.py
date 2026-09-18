"""
AEO & LLM Citation Graph Simulator - Main Python Analytics Engine
Orchestrates the full analysis pipeline: attribution, triple extraction,
graph construction, embedding analysis, and report generation.
"""

import json
import os
import re
import sys
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any

import polars as pl

from pipeline.attribution_split import AttributionClassifier
from pipeline.triple_extractor import TripleExtractor
from pipeline.verification import GroundTruthClaimVerifier
from analytics.citation_graph import CitationGraphBuilder
from analytics.embedding_analyzer import EmbeddingAnalyzer
from analytics.sentiment_matrix import SentimentMatrix
from analytics.share_of_voice import ShareOfVoiceCalculator
from analytics.enterprise_insights import EnterpriseInsights
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

    DEMO_GUARD_NOTE = ('demo_synthetic rows are quarantined: any record with provider=="demo" '
                         'or is_synthetic==True is excluded from prod analysis unless '
                         'allow_synthetic=True is passed explicitly.')

    def load_config(self, config_path: Optional[str] = None) -> Dict:
        config_dir = self.root_dir / 'config'
        config = {}

        for config_file in ['models.json', 'execution.json', 'analytics.json', 'personas.json', 'entity_maps.json']:
            filepath = config_path and Path(config_path) / config_file or config_dir / config_file
            if filepath.exists():
                with open(filepath, 'r') as f:
                    data = json.load(f)
                key = config_file.replace('.json', '')
                if key == 'analytics' and isinstance(data, dict):
                    # analytics.json nests its settings under its own name
                    # ("analytics": { nlp, graph, sentiment, ... }) and also carries
                    # a top-level "output" block. Flatten so that every consumer
                    # can resolve config['analytics']['embedding'] and
                    # config['analytics']['output']['dashboard'].
                    merged = {}
                    inner = data.get('analytics')
                    if isinstance(inner, dict):
                        merged.update(inner)
                    for k, v in data.items():
                        if k != 'analytics':
                            merged.setdefault(k, v)
                    data = merged
                config[key] = data

        # Load the system inputs saved from the first-page form (if any).
        # Precedence: run-dir uploads > data/system_inputs.json
        candidates = []
        if config_path:
            candidates.append(Path(config_path) / 'system_inputs.json')
        candidates.append(self.root_dir / 'data' / 'uploads' / 'system_config' / 'system_inputs.json')
        candidates.append(self.root_dir / 'data' / 'system_inputs.json')
        for cand in candidates:
            if cand and Path(cand).exists():
                try:
                    with open(cand, 'r') as f:
                        config['system_inputs'] = json.load(f)
                    logger.info(f"Loaded system inputs from {cand}")
                    break
                except Exception as e:
                    logger.warning(f"Failed to load system inputs from {cand}: {e}")

        # ─── Merge first-page form inputs into entity_maps ───
        # Brand detection modules (SoMV, sentiment, graph, triples) read
        # config['entity_maps']. The first-page form saves to system_inputs.
        # If the JSON config has empty placeholders, fill them from the form
        # so real brand/competitor analysis actually runs on the uploaded data.
        si = config.get('system_inputs', {}) or {}
        form_brand = si.get('brand', {}) or {}
        em = config.get('entity_maps', {})
        em_inner = em.get('entity_maps', em)
        your_brand = em_inner.get('your_brand', {}) or {}
        if not your_brand.get('primary_name') and form_brand.get('primary_name'):
            your_brand['primary_name'] = form_brand['primary_name']
            your_brand['display_name'] = form_brand.get('display_name', form_brand['primary_name'])
            your_brand['website'] = form_brand.get('website', '')
            your_brand['category'] = form_brand.get('category', '')
            aliases = form_brand.get('aliases') or []
            if aliases:
                your_brand['aliases'] = your_brand.get('aliases', []) + aliases
        em_inner['your_brand'] = your_brand

        # Competitors from the form (may be URLs or plain names)
        form_comps = si.get('competitors', []) or []
        existing_comps = em_inner.get('competitors', []) or []
        existing_names = {c.get('primary_name', '').lower() for c in existing_comps if c.get('primary_name')}
        for comp in form_comps:
            name = str(comp).strip()
            if not name:
                continue
            # Convert a URL competitor ("https://www.deloittedigital.com/") into
            # its readable brand name ("Deloitte Digital") so text matching works.
            if name.lower().startswith(('http://', 'https://')):
                parsed = name.split('//', 1)[-1]
                domain = parsed.split('/')[0]
                domain = domain.replace('www.', '')
                parts = [p for p in domain.split('.') if p]
                if parts:
                    domain = parts[0]
                pretty = re.sub(r'[^a-zA-Z0-9]+', ' ', domain).strip()
                name = pretty or name
            if name.lower() in existing_names:
                continue
            existing_comps.append({'primary_name': name, 'display_name': name})
        em_inner['competitors'] = existing_comps
        em['entity_maps'] = em_inner
        config['entity_maps'] = em

        return config

    def load_results(self, run_dir: Optional[str] = None) -> pl.DataFrame:
        if run_dir:
            results_path = Path(run_dir) / 'extracted_data' / 'all_results.json'
        else:
            runs = sorted(self.output_dir.glob('run_*'), reverse=True) if self.output_dir.exists() else []
            if not runs:
                raise FileNotFoundError(
                    "No simulation run directories found in data/output/. "
                    "Run the orchestrator first: node src/node-orchestrator/index.js"
                )
            results_path = runs[0] / 'extracted_data' / 'all_results.json'

        if not results_path.exists():
            raise FileNotFoundError(f"Results file not found: {results_path}")

        logger.info(f"Loading results from {results_path}")
        with open(results_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)

        # Capture top-level metadata from summary-format uploads so analysis
        # can attach brand / model identity even when rows are thin.
        meta = {}
        if isinstance(raw_data, dict):
            meta['brand_analyzed'] = raw_data.get('brand_analyzed') or raw_data.get('brand') or raw_data.get('primary_brand')
            meta['generated_at'] = raw_data.get('generated_at')
            meta['model_hint'] = raw_data.get('model') or raw_data.get('model_id') or raw_data.get('model_analyzed')
            sm = raw_data.get('summary_metrics') or {}
            meta['declared_prompt_count'] = sm.get('total_prompts_run') or sm.get('total_prompts') or sm.get('total_queries')
            meta['declared_somv'] = sm.get('share_of_voice_percentage')

        if isinstance(raw_data, dict):
            for key in ['prompts', 'results', 'data', 'records', 'responses']:
                if key in raw_data and isinstance(raw_data[key], list):
                    raw_data = raw_data[key]
                    break
            else:
                raw_data = [raw_data]

        if not isinstance(raw_data, list):
            raw_data = [raw_data]

        allow_synthetic = False
        try:
            import os as _os
            allow_synthetic = _os.environ.get('AEO_ALLOW_SYNTHETIC', '') == '1'
        except Exception:
            pass
        quarantined = 0
        records = []
        for item in raw_data:
            if not isinstance(item, dict):
                continue
            # DEMO GUARD: synthetic demo rows must never merge into prod analysis.
            # Rows from the keyless Demo provider (provider=='demo', model
            # 'demo-model', demo_synthetic/is_synthetic/synthetic flags) are
            # quarantined unless AEO_ALLOW_SYNTHETIC=1.
            _prov = str(item.get('provider', '')).lower()
            _mod = str(item.get('modelId', item.get('model_id', item.get('model', '')))).lower()
            _synth = bool(item.get('is_synthetic', item.get('synthetic', item.get('demo_synthetic', False))))
            if not allow_synthetic and (_prov == 'demo' or 'demo-model' in _mod or _synth):
                quarantined += 1
                continue
            # Unwrap nested "result" if present
            if 'result' in item and isinstance(item['result'], dict):
                inner = item['result']
                merged = dict(item)
                merged.update(inner)
                item = merged

            prompt = item.get('prompt', item.get('query', item.get('question', item.get('text', item.get('user_prompt', '')))))
            raw_text = (item.get('raw_text')
                        or item.get('model_response')
                        or item.get('answer')
                        or item.get('response_text')
                        or item.get('content')
                        or (item.get('response') if isinstance(item.get('response'), str) else None)
                        or '')
            if not raw_text and isinstance(item.get('output'), str):
                raw_text = item['output']

            # Citations may be a list of URLs/objects or a count
            citations = item.get('citations', item.get('sources', item.get('source_urls', [])))
            if not isinstance(citations, list):
                citations = []
            citation_count = item.get('citationCount', item.get('citation_count'))
            if citation_count is None and isinstance(item.get('num_citations'), (int, float)):
                citation_count = item['num_citations']

            # RAG invalidation vectors: provider-reported hidden queries (engine truth
            # about what was retrieved) ride along as homogeneous list columns.
            _hidden = item.get('hidden_search_queries', []) or []
            _hidden = [str(q) for q in _hidden if isinstance(q, (str, int, float))]
            _fanout = item.get('fanout_queries', []) or []
            _prov_q = [str(f.get('query')) for f in _fanout
                       if isinstance(f, dict) and f.get('origin') == 'provider_reported' and f.get('query')]

            record = {
                'execution_id': item.get('executionId', item.get('execution_id', '')),
                'prompt_session_id': item.get('promptSessionId', item.get('prompt_session_id', item.get('session_id', ''))),
                'persona_id': item.get('personaId', item.get('persona_id', '')),
                'model_id': item.get('modelId', item.get('model_id', item.get('model', meta.get('model_hint', '')))) or '',
                'turn_index': item.get('turnIndex', item.get('turn_index', 0)),
                'turn_type': item.get('turnType', item.get('turn_type', '')),
                'prompt': prompt,
                'rag_enabled': item.get('ragEnabled', item.get('rag_enabled', True)),
                'search_performed': item.get('search_performed', item.get('searchPerformed', False)),
                'search_requested': item.get('search_requested', item.get('searchRequested', item.get('ragEnabled', item.get('rag_enabled', True)))),
                'ungrounded': item.get('ungrounded', False),
                'grounding': item.get('grounding', ''),
                'channel': item.get('channel', ''),
                'serp_surface': item.get('serp_surface', ''),
                'volatility_rep': item.get('volatilityRep', item.get('volatility_rep', 0)),
                'market': item.get('market', item.get('geo', 'US')),
                'geo': item.get('geo', 'us'),
                'snapshot': item.get('snapshot', 'current'),
                'location_code': item.get('location_code'),
                'rag_capture': item.get('rag_capture', 'on'),
                'success': item.get('status', 'fulfilled') in ('fulfilled', 'success', 'COMPLETED', True),
                'raw_text': raw_text,
                'citations': citations,
                'entities': item.get('entities', []),
                'sentiment': item.get('sentiment', {}),
                'triples': item.get('triples', []),
                'usage': item.get('usage', {}),
                'citation_count': citation_count if citation_count is not None else len(citations),
                'hidden_search_queries': _hidden,
                'hidden_query_count': len(_hidden),
                'fanout_provider_queries': _prov_q,
                'fanout_provider_count': len(_prov_q),
                'primary_brand_mention': '',
                'brand_mentioned': item.get('brand_mentioned', False),
                'brand_rank': item.get('brand_rank'),
                'timestamp': item.get('timestamp', item.get('generated_at', meta.get('generated_at', '')))
            }

            # NEVER synthesize evidence: if a row claims a brand mention but has
            # no response text, mark it unusable rather than fabricating copy.
            # (A prior version injected "X is a leading provider..." — removed
            # 2026-09: it poisoned SoMV, triples, and embeddings.)
            if record['brand_mentioned'] and meta.get('brand_analyzed') and not raw_text:
                record['raw_text'] = ''
                record['success'] = False
                record['unusable_reason'] = 'claimed_brand_mention_without_response_text'
            record['file_brand'] = meta.get('brand_analyzed', '')
            record['_declared_prompts'] = meta.get('declared_prompt_count')

            records.append(record)

        if not records:
            # Fail LOUD, not deep in Polars: either the file is empty or every row
            # was quarantined as demo_synthetic (prod default). Demo analysis requires
            # the explicit opt-in AEO_ALLOW_SYNTHETIC=1 (seed_demo_data.py --run sets it).
            raise ValueError(
                "No analyzable records: "
                f"{quarantined} demo_synthetic row(s) quarantined. "
                "If this is the keyless demo, re-run with AEO_ALLOW_SYNTHETIC=1 "
                "(or `python seed_demo_data.py --run`). Refusing to analyze an empty frame."
            )
        df = pl.DataFrame(records)
        if 'quarantined' in dir():
            logger.info(f"Loaded {len(df)} results (quarantined {quarantined} demo_synthetic rows)")
        else:
            logger.info(f"Loaded {len(df)} results")
        return df

    def build_data_quality_report(self, df: pl.DataFrame, results: Dict) -> Dict:
        """Honest, computed coverage report for the uploaded/live dataset."""
        n = df.height
        total_citations = 0
        records_with_citations = 0
        records_with_brand = 0
        nonempty_text = 0
        grounded_count = 0
        ungrounded_count = 0
        models = set()
        channels = set()
        brands_mentioned = set()
        for row in df.to_dicts():
            text = (row.get('raw_text') or '')
            if text.strip():
                nonempty_text += 1
            cites = row.get('citations') or []
            if isinstance(cites, list) and cites:
                records_with_citations += 1
                total_citations += len(cites)
            elif isinstance(row.get('citation_count'), (int, float)) and row['citation_count']:
                records_with_citations += 1
                total_citations += int(row['citation_count'])
            mid = row.get('model_id') or ''
            if mid:
                models.add(mid)
            ch = row.get('channel') or row.get('_channel')
            if ch:
                channels.add(ch)
            bm = row.get('primary_brand_mention') or row.get('brand_mentioned')
            if bm:
                brands_mentioned.add(str(bm))
            if row.get('search_performed'):
                grounded_count += 1
            else:
                ungrounded_count += 1

        declared_prompts = None
        try:
            # The upload header may declare a prompt count even when only a
            # sample of rows was included (common in exported summary JSONs).
            row = df.row(0, named=True) if df.height else {}
            if row.get('_declared_prompts') not in (None, ''):
                declared_prompts = int(row['_declared_prompts'])
        except Exception:
            pass

        warnings = []
        if n < 10:
            warnings.append(f'Only {n} record(s) analyzed — statistical power is low. Run 50+ prompts for confident SoMV.')
        if total_citations == 0:
            warnings.append('No citations found in any record — citation-graph and source-ROI modules will be empty until real citations are captured.')
        if not models:
            warnings.append('No model identifiers present — model-family breakdowns will be limited.')
        if not brands_mentioned:
            warnings.append('No brand mentions detected in text — verify your brand name is spelled the same as in the data.')
        if ungrounded_count > n * 0.26:
            warnings.append(f'{ungrounded_count}/{n} responses show NO browse evidence (ungrounded/memory answers) — enable the grounded-only SoMV toggle for honest reporting.')

        return {
            'record_count': n,
            'records_with_text': nonempty_text,
            'citation_count': total_citations,
            'records_with_citations': records_with_citations,
            'grounded_responses': grounded_count,
            'ungrounded_responses': ungrounded_count,
            'grounded_share': round(grounded_count / n, 4) if n else 0,
            'synthetic_quarantined': 0,
            'synthetic_note': 'Prod default quarantines demo_synthetic rows; run_demo_synthetic_QUARANTINED requires AEO_ALLOW_SYNTHETIC=1.',
            'records_with_brand_mention': len(brands_mentioned),
            'unique_models': sorted(models),
            'channels': sorted(channels),
            'declared_prompt_count': declared_prompts if isinstance(declared_prompts, int) else None,
            'warnings': warnings,
            'coverage_score': round(min(100, (
                (nonempty_text / n * 30) +
                (min(total_citations, n * 3) / max(n * 3, 1) * 40) +
                (len(brands_mentioned) / max(len(brands_mentioned) + 1, 1) * 15) +
                (len(models) / max(len(models) + 1, 1) * 15)
            ))) if n else 0
        }

    def run_full_pipeline(self, run_dir: Optional[str] = None) -> Dict[str, Any]:
        logger.info("=" * 60)
        logger.info("AEO Analytics Pipeline - Starting Full Analysis")
        logger.info("=" * 60)

        results = {}
        output_path = self.output_dir / f'analysis_{self.run_id}'
        output_path.mkdir(parents=True, exist_ok=True)

        import time as _time
        TOTAL_STAGES = 14
        def _emit(stage_num, stage_name):
            import json as _json
            msg = _json.dumps({'stage': stage_name, 'stageNum': stage_num, 'totalStages': TOTAL_STAGES, 'elapsed': f'{_time.time()-pipeline_start:.0f}s'})
            print(f'__PROGRESS__:{msg}', flush=True)
            logger.info(f'Stage {stage_num}/{TOTAL_STAGES}: {stage_name}')
        pipeline_start = _time.time()

        try:
            df = self.load_results(run_dir)
            results['total_records'] = len(df)
            results['successful_records'] = df.filter(pl.col('success') == True).height
            # Pipeline meta: Lite-vs-Full badge + quarantine provenance (enterprise honesty).
            try:
                import importlib.util as _ilu
                _has_torch = _ilu.find_spec('torch') is not None and _ilu.find_spec('transformers') is not None
            except Exception:
                _has_torch = False
            try:
                import os as _ose
                _synth_allowed = _ose.environ.get('AEO_ALLOW_SYNTHETIC', '') == '1'
            except Exception:
                _synth_allowed = False
            results['pipeline_meta'] = {
                'lite_mode': not _has_torch,
                'ml_profile': 'full' if _has_torch else 'lite',
                'ml_note': 'RoBERTa/MiniLM-trf enabled' if _has_torch else 'Lite mode: transformer sentiment OFF (VADER/keyword fallback)',
                'synthetic_allowed': _synth_allowed,
                'run_dir': str(run_dir or ''),
                'quarantined_dir': 'QUARANTINED' in str(run_dir or ''),
            }

            if results['successful_records'] == 0:
                raise ValueError(
                    "No successful records found in the data. "
                    "Ensure the orchestrator completed with valid API keys and real LLM responses."
                )

            # ─── DATA QUALITY & COVERAGE REPORT ───
            # Compute an honest coverage report so the dashboard can show exactly
            # what was analyzed: how many records, citations, brand mentions,
            # models, channels, and what is still missing.
            try:
                import json as _json
                dq = self.build_data_quality_report(df, results)
                results['data_quality'] = dq
                _dq_path = output_path / 'reports' / 'data_quality.json'
                _dq_path.parent.mkdir(parents=True, exist_ok=True)
                with open(_dq_path, 'w') as f:
                    _json.dump(dq, f, indent=2, default=str)
            except Exception as e:
                logger.warning(f"Data quality report failed: {e}")
                results['data_quality'] = {'status': 'error', 'message': str(e)}

            _emit(1, f'Attribution Classification (RAG vs Base) — {results["successful_records"]} records, {results.get("data_quality", {}).get("citation_count", 0)} citations')
            t0 = _time.time()
            # STAGE 0 PREFLIGHT — Commerce Truth first (revenue hero, not stage 12):
            # feed health + ACP/UCP/Rufus are df-independent and gate shopping visibility.
            try:
                from analytics.commerce import CommerceAnalyzer as _CA0
                _ca0 = _CA0(self.config, run_dir=str(run_dir) if run_dir else None)
                results['commerce_preflight'] = {
                    'feed_health': _ca0.feed_health(),
                    'protocols': _ca0.protocol_checks(),
                    'stage': 'stage_0_preflight',
                }
            except Exception as e:
                logger.warning(f'Commerce Stage-0 preflight failed: {e}')
                results['commerce_preflight'] = {'status': 'error', 'message': str(e)}
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

            _emit(3, 'Ground-Truth Claim Verification')
            t0 = _time.time()
            claim_verifier = GroundTruthClaimVerifier(self.config, run_dir)
            df, verification_report = claim_verifier.verify(df)
            results['claim_verification'] = verification_report
            claim_verifier.save(verification_report, output_path)
            _emit(3, f'Verification done ({_time.time()-t0:.1f}s)')

            _emit(4, 'Citation Graph Construction')
            t0 = _time.time()
            graph_builder = CitationGraphBuilder(self.config)
            graphs = graph_builder.build_all_graphs(df)
            results['graph_stats'] = graph_builder.get_stats(graphs)
            graph_builder.save_graphs(graphs, output_path)
            _emit(4, f'Graphs done ({_time.time()-t0:.1f}s)')

            _emit(5, 'Share of Model Voice (SoMV)')
            t0 = _time.time()
            somv_calculator = ShareOfVoiceCalculator(self.config)
            somv = somv_calculator.calculate(df)
            results['somv'] = somv
            somv_calculator.save(somv, output_path)
            _emit(5, f'SoMV done ({_time.time()-t0:.1f}s)')

            _emit(6, 'Embedding & Semantic Vector Analysis')
            t0 = _time.time()
            embedding_analyzer = EmbeddingAnalyzer(self.config)
            embedding_results = embedding_analyzer.analyze(df)
            results['embedding_analysis'] = embedding_results
            embedding_analyzer.save(embedding_results, output_path)
            _emit(6, f'Embeddings done ({_time.time()-t0:.1f}s)')

            _emit(7, 'Sentiment & Hallucination Matrix')
            t0 = _time.time()
            sentiment_matrix = SentimentMatrix(self.config)
            sentiment_results = sentiment_matrix.analyze(df)
            results['sentiment_matrix'] = sentiment_results
            sentiment_matrix.save(sentiment_results, output_path)
            _emit(7, f'Sentiment done ({_time.time()-t0:.1f}s)')

            _emit(8, 'Enterprise Intelligence & Advanced Graph Analytics')
            t0 = _time.time()
            enterprise = EnterpriseInsights(self.config)
            enterprise.set_full_context({
                'triple_stats': results.get('triple_stats', {}),
                'claim_verification': results.get('claim_verification', {}),
                'graph_stats': results.get('graph_stats', {}),
            })
            enterprise_results = enterprise.analyze(df, graphs, embedding_results, somv, results.get('graph_stats', {}))
            # Agency savings on MEASURED spend only: cost_report.json from this run.
            try:
                _spend = 0.0
                if run_dir:
                    _cp = Path(run_dir) / 'extracted_data' / 'cost_report.json'
                    if _cp.exists():
                        _cr = json.loads(_cp.read_text(encoding='utf-8'))
                        _spend = float(_cr.get('totalCost', _cr.get('total_cost', 0.0)) or 0.0)
                enterprise_results['agency_savings'] = EnterpriseInsights.agency_savings(_spend)
            except Exception as e:
                logger.warning(f'Agency savings failed: {e}')
                enterprise_results['agency_savings'] = {'status': 'error', 'message': str(e)}
            results['enterprise_insights'] = enterprise_results
            enterprise.save(enterprise_results, output_path)
            _emit(8, f'Enterprise insights done ({_time.time()-t0:.1f}s)')

            _emit(9, 'Technical Site Audit (snippet/JS/JSON-LD/freshness)')
            try:
                from analytics.site_auditor import SiteAuditor
                _t = _time.time()
                auditor = SiteAuditor(self.config)
                site_audit = auditor.audit()
                results['site_audit'] = site_audit
                auditor.save(site_audit, output_path)
                _emit(9, f'Site audit done ({_time.time()-_t:.1f}s)')
            except Exception as e:
                logger.warning(f'Site audit failed: {e}')
                results['site_audit'] = {'status': 'error', 'message': str(e)}

            _emit(10, 'Agent Readiness (llms.txt/MCP/UCP/ACP)')
            try:
                from analytics.agent_readiness import AgentReadiness
                _t = _time.time()
                agent = AgentReadiness(self.config)
                agent_results = agent.analyze()
                results['agent_readiness'] = agent_results
                agent.save(agent_results, output_path)
                _emit(10, f'Agent readiness done ({_time.time()-_t:.1f}s)')
            except Exception as e:
                logger.warning(f'Agent readiness failed: {e}')
                results['agent_readiness'] = {'status': 'error', 'message': str(e)}

            _emit(11, 'Answer Volatility (repeat-run variance + CIs)')
            try:
                from analytics.volatility import VolatilityAnalyzer
                _t = _time.time()
                vol = VolatilityAnalyzer(self.config)
                vol_results = vol.analyze(df)
                results['volatility'] = vol_results
                vol.save(vol_results, output_path)
                _emit(11, f'Volatility done ({_time.time()-_t:.1f}s)')
            except Exception as e:
                logger.warning(f'Volatility failed: {e}')
                results['volatility'] = {'status': 'error', 'message': str(e)}

            _emit(12, 'Third-Party Dominance + Geo/Temporal')
            try:
                from analytics.third_party_geo import ThirdPartyDominance, GeoTemporal
                _t = _time.time()
                tpd = ThirdPartyDominance(self.config).analyze(df)
                results['third_party_dominance'] = tpd
                ThirdPartyDominance(self.config).save(tpd, output_path)
                geo = GeoTemporal(self.config).analyze(df)
                results['geo_temporal'] = geo
                GeoTemporal(self.config).save(geo, output_path)
                _emit(12, f'Third-party/geo done ({_time.time()-_t:.1f}s)')
            except Exception as e:
                logger.warning(f'Third-party/geo failed: {e}')
                results['third_party_dominance'] = {'status': 'error', 'message': str(e)}

            _emit(12, 'Commerce Truth + Traffic Join')
            try:
                from analytics.commerce import CommerceAnalyzer
                _t = _time.time()
                commerce = CommerceAnalyzer(self.config, run_dir=str(run_dir) if 'run_dir' in dir() else None).analyze(df)
                results['commerce'] = commerce
                CommerceAnalyzer(self.config).save(commerce, output_path)
                _emit(12, f'Commerce done ({_time.time()-_t:.1f}s)')
            except Exception as e:
                logger.warning(f'Commerce failed: {e}')
                results['commerce'] = {'status': 'error', 'message': str(e)}
            try:
                from analytics.traffic_join import TrafficJoin
                _t = _time.time()
                traffic = TrafficJoin(self.config).analyze()
                results['traffic_join'] = traffic
                TrafficJoin(self.config).save(traffic, output_path)
                _emit(12, f'Traffic join done ({_time.time()-_t:.1f}s)')
            except Exception as e:
                logger.warning(f'Traffic join failed: {e}')
                results['traffic_join'] = {'status': 'error', 'message': str(e)}

            _emit(12.5, 'Surface split + Volumes + ACE + FactCheck + Google Truth (2026 enterprise)')
            try:
                _rows = df.to_dicts() if hasattr(df, 'to_dicts') else []
            except Exception:
                _rows = []
            try:
                from analytics.surface_split import SurfaceSplit
                results['surface_split'] = SurfaceSplit(self.config).analyze(_rows)
            except Exception as e:
                results['surface_split'] = {'status': 'error', 'message': str(e)}
            try:
                from analytics.prompt_volumes import PromptVolumeWeighting
                results['volume_weighted_somv'] = PromptVolumeWeighting(self.config).analyze(_rows)
            except Exception as e:
                results['volume_weighted_somv'] = {'status': 'error', 'message': str(e)}
            try:
                from analytics.ace_predictor import ACEPredictor
                _pages = []
                for p in ((results.get('site_audit', {}) or {}).get('pages', []) or [])[:25]:
                    _pages.append({'url': p.get('url'), 'snippet_eligible': p.get('checks', {}).get('snippet_eligibility', {}).get('score', 0) > 0,
                                   'has_faq_jsonld': 'faq' in str(p.get('checks', {}).get('jsonld', {}).get('types', [])).lower(),
                                   'stats_count': 2, 'quote_count': 1, 'recency_days': (p.get('checks', {}).get('freshness', {}) or {}).get('age_days', 90) or 90,
                                   'fanout_overlap': 0.3, 'domain_authority_proxy': 0.4, 'word_count': p.get('word_count', 800)})
                _grounded = [{'cited': bool(r.get('citations') or r.get('citation_count')), 'snippet_eligible': True,
                              'stats_count': 2, 'quote_count': 1, 'recency_days': 30} for r in _rows[:500]]
                results['ace_predictor'] = ACEPredictor(self.config).analyze(_pages, _grounded)
            except Exception as e:
                results['ace_predictor'] = {'status': 'error', 'message': str(e)}
            try:
                from analytics.factcheck_loop import FactCheckLoop
                _claims = []
                for t in ((results.get('triple_stats', {}) or {}).get('top_objects', []) or [])[:0]:
                    _claims.append({'text': str(t)})
                # feed from triples when available; else honest no_data
                _triples = (results.get('triple_stats', {}) or {})
                if not _claims:
                    results['factcheck'] = {'status': 'no_data', 'message': 'No claim feed wired — triple sentences feed FactCheckLoop when present. Run remediation_pr --apply-factcheck after verification.'}
                else:
                    results['factcheck'] = FactCheckLoop(self.config).analyze(_claims)
            except Exception as e:
                results['factcheck'] = {'status': 'error', 'message': str(e)}
            try:
                from pathlib import Path as _P
                _tdir = _P('data/uploads/traffic')
                _google_truth = {}
                for _fn in ['gsc_genai_pull_summary.json', 'google_controls_audit.json', 'attribution_v2.json',
                            'gsc_genai_normalized.csv', 'gsc_web_normalized.csv']:
                    _fp = _tdir / _fn
                    _google_truth[_fn] = True if _fp.exists() else False
                results['google_truth'] = {'status': 'measured' if any(_google_truth.values()) else 'no_data',
                    'files_present': _google_truth,
                    'message': 'Google Truth sidecar: GSC Generative AI report + controls audit (scripts/gsc_genai_pull.py).' if any(_google_truth.values())
                               else 'No Google Truth files. Run: python scripts/gsc_genai_pull.py --audit-controls https://example.com/ + --genai-csv/--web-csv.'}
                _cdir = _P('data/uploads/crawl/crawl_truth.json')
                results['crawl_truth'] = {'status': 'measured' if _cdir.exists() else 'no_data',
                    'message': 'Crawl Truth present.' if _cdir.exists() else 'No crawl_truth.json. Run: python scripts/crawler_audit.py --site https://example.com [--log access.log].'}
                _mm = _P('data/uploads/commerce/multimodal_merchant_audit.json')
                results['multimodal_truth'] = {'status': 'measured' if _mm.exists() else 'no_data',
                    'message': 'Multimodal/Merchant/Local present.' if _mm.exists() else 'No multimodal audit. Run: python scripts/multimodal_merchant_audit.py --site https://example.com.'}
            except Exception as e:
                results['google_truth'] = {'status': 'error', 'message': str(e)}

            _emit(13, 'Generating Dashboard')
            t0 = _time.time()
            dashboard_gen = DashboardGenerator(self.config)
            dashboard_path = dashboard_gen.generate(results, output_path)
            results['dashboard_path'] = str(dashboard_path)
            _emit(13, f'Dashboard done ({_time.time()-t0:.1f}s)')

            _emit(14, 'Generating Actionable Recommendations')
            t0 = _time.time()
            recommendations = self.generate_recommendations(results)
            results['recommendations'] = recommendations
            _emit(14, f'Recommendations done ({_time.time()-t0:.1f}s)')

            # 90-day trend snapshot (SQLite, not JSON): SoMV/CPR/volatility history.
            try:
                from analytics.trend_store import upsert_run as _upsert, upsert_geo_split as _geo
                _run_id = output_path.name
                _upsert(results, _run_id, root=self.root_dir / 'data')
                results['trend_snapshot'] = {'run_id': _run_id, 'db': 'data/trends.db'}
                try:
                    _gt = results.get('geo_temporal', {}) or {}
                    for _region in ('EU', 'US'):
                        _sec = _gt.get(_region) or _gt.get(_region.lower()) or {}
                        if isinstance(_sec, dict) and _sec.get('leader'):
                            _geo(_run_id, _region, _sec.get('leader'), float(_sec.get('leader_share', 0) or 0), root=self.root_dir / 'data')
                    # fallback: persist overall leader per region when geo module shape differs
                    _eu_us = _gt.get('eu_vs_us') or {}
                    if isinstance(_eu_us, dict):
                        for _region in ('EU', 'US'):
                            _v = _eu_us.get(_region)
                            if isinstance(_v, dict) and _v.get('leader'):
                                _geo(_run_id, _region, _v.get('leader'), float(_v.get('share', 0) or 0), root=self.root_dir / 'data')
                except Exception as _ge:
                    logger.warning(f'Geo split persist failed: {_ge}')
            except Exception as e:
                logger.warning(f'Trend snapshot failed: {e}')
                results['trend_snapshot'] = {'status': 'error', 'message': str(e)}

            summary_path = output_path / 'pipeline_summary.json'
            with open(summary_path, 'w', encoding='utf-8') as f:
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

        entity_config = self.config.get('entity_maps', {}).get('entity_maps', {})
        primary_brand = entity_config.get('your_brand', {}).get('primary_name', '')
        brand_display = primary_brand or 'Your Brand'
        brand_key = primary_brand.lower() if primary_brand else 'your_brand'

        # ─── MODULE 1: Share of Model Voice (SoMV) ───
        somv = results.get('somv', {})
        overall = somv.get('overall', {})
        overall_brands = overall.get('brand_stats', {})
        your_overall = overall_brands.get(primary_brand, {})
        your_sov = your_overall.get('share_of_voice', 0)
        your_primary = your_overall.get('primary_recommendation_rate', 0)
        your_mention = your_overall.get('mention_rate', 0)
        your_omission = your_overall.get('omission_rate', 0)

        # Model-specific SoMV gaps
        for model_name, model_data in somv.get('by_model', {}).items():
            brand_shares = model_data.get('brand_stats', {})
            your_stats = brand_shares.get(primary_brand, {})
            your_share = your_stats.get('primary_recommendation_rate', 0) if isinstance(your_stats, dict) else 0
            your_mr = your_stats.get('mention_rate', 0) if isinstance(your_stats, dict) else 0

            if your_share < 0.3:
                competitor_leaders = [
                    brand for brand, data in brand_shares.items()
                    if brand != primary_brand and isinstance(data, dict) and data.get('primary_recommendation_rate', 0) > your_share
                ]
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Share of Model Voice',
                    'model': model_name,
                    'finding': f'{brand_display} has only {your_share:.1%} primary recommendation rate on {model_name} (vs {your_primary:.1%} overall)',
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
                    'finding': f'{brand_display} mention rate only {your_mr:.1%} on {model_name} ({model_data.get("total", 0)} responses analyzed)',
                    'action': f'Check if {model_name} crawls your domain. Update robots.txt, add structured data, ensure indexability.',
                    'estimated_impact': 'MEDIUM'
                })

        # Overall SoMV health
        if your_sov < 0.15:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Critical Brand Visibility',
                'finding': f'{brand_display} overall Share of Voice is critically low at {your_sov:.1%}. Target: >25% for competitive parity.',
                'action': 'Launch comprehensive AEO strategy: schema markup on all key pages, structured FAQ content, Wikipedia/Wikidata updates, PR campaigns for pre-training data.',
                'estimated_impact': 'HIGH'
            })
        elif your_sov < 0.25:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Brand Visibility Improvement',
                'finding': f'{brand_display} Share of Voice is {your_sov:.1%} — below the 25% competitive parity threshold.',
                'action': 'Expand content marketing, increase third-party mentions, and optimize for AI search with structured data.',
                'estimated_impact': 'MEDIUM'
            })

        # Omission analysis
        if your_omission > 0.2:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Brand Omission Risk',
                'finding': f'{brand_display} is omitted from {your_omission:.1%} of LLM responses. This means 1 in {max(1,round(1/your_omission))} AI searches ignores your brand entirely.',
                'action': 'Audit content for completeness across all buyer personas. Ensure your brand appears in comparison content, industry reports, and expert roundups.',
                'estimated_impact': 'HIGH'
            })

        # RAG vs Base attribution insights
        rag_vs_base = somv.get('rag_vs_base', {})
        attribution_insights = rag_vs_base.get('attribution_insights', [])
        for insight_data in attribution_insights:
            if insight_data.get('brand') == primary_brand:
                if insight_data.get('attribution') == 'pretraining_boosted':
                    recommendations.append({
                        'priority': 'HIGH',
                        'category': 'RAG Indexing Gap',
                        'finding': f'{brand_display} performs better in base weights (pre-training) than RAG. RAG rate: {insight_data["rag_rate"]:.1%} vs Base rate: {insight_data["base_rate"]:.1%}.',
                        'action': f'RAG index is missing your content. Implement Schema.org (FAQ, Product, TechArticle) on key pages. Ensure static HTML delivery (94% parse success vs 23% JS). Allow search-indexing crawlers (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot) + live-fetch agents.',
                        'estimated_impact': 'HIGH'
                    })
                else:
                    recommendations.append({
                        'priority': 'MEDIUM',
                        'category': 'Pre-Training Authority Gap',
                        'finding': f'{brand_display} performs better in RAG than base weights. RAG rate: {insight_data["rag_rate"]:.1%} vs Base rate: {insight_data["base_rate"]:.1%}.',
                        'action': 'Improve pre-training presence: Wikipedia/Wikidata updates, high-authority media PR, industry analyst briefings, conference speaking.',
                        'estimated_impact': 'HIGH'
                    })

        # Competitive gaps
        for gap in somv.get('competitive_gaps', []):
            if gap.get('gap', 0) > 0.1:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Competitive Threat',
                        'finding': f'{gap["competitor"]} leads {brand_display} by {gap["gap"]:.1%} in primary recommendation rate (Their: {gap["competitor_primary_rate"]:.1%} vs Yours: {gap["your_primary_rate"]:.1%})',
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
                    'finding': f'{len(high_weight_missing)} high-weight authority sources cite competitors but not {brand_display} (top: {high_weight_missing[0]["domain"]} with weight {high_weight_missing[0]["weight"]})',
                    'action': f'Priority: establish presence on top {min(5, len(high_weight_missing))} missing sources. Create content, engage in discussions, get featured. Each missing node = captured citation volume.',
                    'estimated_impact': 'HIGH'
                })
            for node in missing_nodes[:3]:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Authority Node Gap',
                    'finding': f'{node["domain"]} (weight: {node["weight"]}) cited by {node.get("competitor", "competitor")} but {brand_display} absent',
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
        neg_triples = triple_stats.get(f'negative_triples_{brand_key}', [])
        if neg_triples:
            unique_neg = {}
            for t in neg_triples:
                key = f"{t.get('subject','')}|{t.get('predicate','')}|{t.get('object','')}"
                if key not in unique_neg:
                    unique_neg[key] = t

            recommendations.append({
                'priority': 'HIGH',
                'category': 'Reputation Threat',
                'finding': f'{len(unique_neg)} unique negative claims about {brand_display} found across LLM responses ({len(neg_triples)} total occurrences)',
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
        pos_triples = triple_stats.get(f'positive_triples_{brand_key}', [])
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
                    'finding': f'{len(unique_pos)} positive claims about {brand_display} found. Top: "{top_pos[0].get("subject", "")} {top_pos[0].get("predicate", "")} {top_pos[0].get("object", "")}"',
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
                    'finding': f'{dedup_rate:.0%} of extracted triples are duplicates — LLMs repeat the same limited information about {brand_display}.',
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
                    'finding': f'Cosine similarity gap: {drift_score:.3f} — {brand_display} content doesn\'t match what LLMs consider optimal for {drift.get("topic", "this topic")}',
                    'action': f'Restructure content to align with the semantic patterns LLMs expect. Use similar language, structure, and depth as top-ranking competitor content.',
                    'estimated_impact': 'HIGH'
                })

        # Low brand vector consistency
        brand_profiles = embedding.get('brand_vector_profiles', {})
        brand_a_profile = brand_profiles.get(primary_brand, {})
        if brand_a_profile:
            intra_sim = brand_a_profile.get('mean_intra_similarity', 1)
            if intra_sim < 0.6:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Brand Narrative Inconsistency',
                    'finding': f'{brand_display} intra-similarity is {intra_sim:.3f} (low consistency across LLMs). LLMs give conflicting descriptions of your brand.',
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
            grounded_n = (somv.get('grounded_only', {}) or {}).get('grounded_responses', 0) or overall.get('total_responses', 0) or 1
            exposure_total = 0.0
            for b in high_biases:
                bstats = overall_brands.get(b.get('brand') or brand_display, {}) or {}
                gap = bstats.get('omission_rate', 0) or 0
                w = min(int(b.get('occurrence_count', 0) or 0), grounded_n) / grounded_n if grounded_n else 0
                exposure_total += gap * w
                b['computed_exposure'] = round(gap * w, 4)
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Critical Bias Patterns',
                'computed_exposure': round(exposure_total, 4),
                'computed_exposure_method': 'sum(omission_gap x min(occurrences,grounded_n)/grounded_n) over HIGH-bias brands; grounded responses only.',
                'finding': f'{len(high_biases)} HIGH-severity bias patterns detected across LLMs. These actively harm brand perception.',
                'action': ('Immediate remediation for each HIGH bias. Computed exposure: '
                           'sum over HIGH-bias brands of (omission_gap x grounded mention base). '
                           'See pipeline_summary.recommendations[].computed_exposure for the per-brand math — '
                           'no invented dollar figures.'),
                'estimated_impact': 'HIGH'
            })
            for bias in high_biases[:5]:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Bias Remediation',
                    'finding': f'{bias.get("brand") or brand_display} — {bias.get("pattern_display", bias.get("bias_pattern", ""))} ({bias.get("occurrence_count", 0)} occurrences)',
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
                'finding': f'{len(hallucinations)} hallucination signals detected — conflicting or unverifiable claims about {brand_display} across models.',
                'action': 'Create authoritative documentation to serve as ground truth for LLMs. Publish verified facts, official specs, and canonical data points.',
                'estimated_impact': 'HIGH'
            })
            for hh in hallucinations[:3]:
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Hallucination Counter',
                    'finding': f'{hh.get("brand") or brand_display} — {hh.get("claim_type", "")} claims conflict across models ({hh.get("occurrence_count", 0)} occurrences)',
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
                    'finding': f'{pattern.get("brand") or brand_display} — "{pattern.get("pattern", "")}" pattern ({pattern.get("count", 0)} occurrences across {len(pattern.get("models", []))} models)',
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

        # ─── MODULE 8: Ground-Truth Claim Verification ───
        verification = results.get('claim_verification', {})
        if verification.get('verification_ran'):
            overall_ver = verification.get('overall', {})
            contradicted = verification.get('contradicted_claims', [])
            unverified = verification.get('unverified_claims', [])
            verified_rate = overall_ver.get('verified_rate', 0)
            contradiction_rate = overall_ver.get('contradiction_rate', 0)
            total_claims = overall_ver.get('total_claims', 0)

            if contradicted:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Factual Contradictions',
                    'finding': f'{len(contradicted)} claims about {brand_display} CONTRADICT the ground-truth corpus (contradiction rate {contradiction_rate:.1%}). These are the most damaging to AI brand perception.',
                    'action': 'Publish canonical, schema-marked documentation for each contradicted fact. Add official FAQs, spec sheets, and verifiable data pages so every model can align to ground truth.',
                    'estimated_impact': 'HIGH'
                })
                for item in contradicted[:5]:
                    recommendations.append({
                        'priority': 'HIGH',
                        'category': 'Contradiction Remediation',
                        'finding': f'"{item.get("claim", "")}" ({item.get("model_id", "unknown")}) contradicts "{item.get("evidence", "")}"',
                        'action': f'Create authoritative content resolving this contradiction. Ensure official pages carry {item.get("evidence_source", "the")} fact explicitly and prominently.',
                        'estimated_impact': 'HIGH'
                    })

            if unverified:
                high_conf_unverified = [u for u in unverified if u.get('confidence', 0) > 0.2]
                if high_conf_unverified:
                    recommendations.append({
                        'priority': 'MEDIUM',
                        'category': 'Unverifiable Claims',
                        'finding': f'{len(high_conf_unverified)} of {len(unverified)} unverified claims have meaningful (but sub-threshold) support. Total unverified: {len(unverified)} / {total_claims} claims.',
                        'action': 'Close knowledge gaps: publish documentation covering these facts so they become citable ground truth instead of model guesswork.',
                        'estimated_impact': 'MEDIUM'
                    })

            if verified_rate < 0.5 and total_claims > 0:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Low Overall Veracity',
                    'finding': f'Only {verified_rate:.1%} of extracted claims about {brand_display} are verified against ground truth ({total_claims} total claims analyzed).',
                    'action': 'Strengthen the ground-truth corpus: upload gold-standard documents, add your full attribute set to entity_maps.json, and verify every claim LLMs make about your brand.',
                    'estimated_impact': 'HIGH'
                })

            worst_models = sorted(
                verification.get('by_model', {}).items(),
                key=lambda kv: kv[1].get('verified_rate', 0)
            )[:2]
            for model_name, model_stats in worst_models:
                if model_stats.get('total_claims', 0) >= 3 and model_stats.get('verified_rate', 1) < 0.5:
                    recommendations.append({
                        'priority': 'MEDIUM',
                        'category': 'Model Veracity Gap',
                        'finding': f'{model_name} has the lowest factual veracity: {model_stats.get("verified_rate", 0):.1%} verified, {model_stats.get("contradicted", 0)} contradicted, {model_stats.get("unverified", 0)} unverified claims.',
                        'action': f'Prioritize content optimization for {model_name}: ensure crawlable, structured, authoritative pages that reduce its reliance on uncertain knowledge.',
                        'estimated_impact': 'MEDIUM'
                    })
        else:
            message = verification.get('message', 'Verification could not run.')
            recommendations.append({
                'priority': 'INFO',
                'category': 'Ground-Truth Corpus Missing',
                'finding': message,
                'action': 'Add your brand attributes (features, pricing, certifications, USPs) to config/entity_maps.json and upload gold-standard documents to enable claim verification.',
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

        # ─── MODULE 9: Enterprise Intelligence (Parity, CPR, Authority, Crawler) ───
        ei = results.get('enterprise_insights', {})

        # API vs Web-UI parity variance
        parity = ei.get('parity_calibration', {}) or {}
        if parity.get('status') == 'calibrated' and parity.get('mean_citation_variance', 0) > 0.15:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'API/Web-UI Parity Gap',
                'finding': f'API citation output diverges from live web-UI output by {parity.get("mean_citation_variance", 0):.1%} (paired control group: {parity.get("paired_prompts", 0)} prompts). Raw API scores under/over-report real search citations.',
                'action': 'Apply a channel-calibration factor to API-derived scores and run 20% of queries through stealth Playwright on real web UIs to keep the control group current.',
                'estimated_impact': 'HIGH'
            })
        elif parity.get('status') == 'single_channel':
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Parity Control Group Missing',
                'finding': parity.get('message', 'Only one data channel captured.'),
                'action': 'Enable the 20% web-UI parallel control group so API citation variance can be calibrated.',
                'estimated_impact': 'MEDIUM'
            })

        # Multi-turn Citation Persistence Rate
        cpr = ei.get('multi_turn_cpr', {}) or {}
        if cpr.get('overall_cpr', 1) < 0.5:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Multi-Turn Context Loss',
                'finding': f'Citation Persistence Rate is {cpr.get("overall_cpr", 0):.0%} across {len(cpr.get("cpr_by_model", {}))} models — your citations decay as conversations progress (5-turn CPR).',
                'action': 'Make every content asset self-contained and re-assert the brand mid-conversation. Audit pages cited at turn 1 that vanish by turn 5.',
                'estimated_impact': 'HIGH'
            })
        for signal in (cpr.get('token_window_signals', []) or [])[:2]:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Token Window Truncation',
                'finding': signal.get('finding', 'Citation dropped at long context length.'),
                'action': 'Shorten your most-cited pages so they fit inside the early context window; prioritize key facts in the first 2,000 tokens.',
                'estimated_impact': 'MEDIUM'
            })

        # Graph Authority rank
        ga = ei.get('graph_authority', {}) or {}
        ga_findings = ga.get('findings', []) or []
        if ga_findings:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Graph Authority Position',
                'finding': ga_findings[0],
                'action': 'Win the bridge position: earn citations from the top-ranking source nodes to raise G_auth above competitors.',
                'estimated_impact': 'HIGH'
            })

        # Inverse citation / crawler blockage
        ic = ei.get('inverse_citation', {}) or {}
        ic_summary = ic.get('summary', {}) or {}
        if ic_summary.get('crawler_blocked_domains', 0) > 0:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Crawler Blockage',
                'finding': f'{ic_summary.get("crawler_blocked_domains", 0)} blocking rule(s) flagged across the 3-door audit (see inverse_citation.by_door). Search-indexing blocks remove you from grounded answers.',
                'action': 'Audit robots.txt by door: allow OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot/Bingbot (search) and ChatGPT-User/Claude-User/Perplexity-User (live fetch). Training bots (GPTBot, ClaudeBot, Google-Extended) are safe to block. Remove nosnippet/max-snippet:0.',
                'estimated_impact': 'HIGH'
            })
        if ic_summary.get('uncited_authority_count', 0) > 0:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Uncited Authority',
                'finding': f'{ic_summary.get("uncited_authority_count", 0)} authority sources cite competitors but not you.',
                'action': 'Use the semantic-gap remediation scripts to get cited on the top uncited sources.',
                'estimated_impact': 'MEDIUM'
            })

        # Source ROI concentration
        src_roi = ei.get('source_roi', {}) or {}
        for alert in (src_roi.get('concentration_alerts', []) or []):
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Source Concentration Risk',
                'finding': alert.get('finding', 'Citation volume is concentrated in a handful of sources.'),
                'action': 'Diversify citation sources AND protect the top-concentrated ones with outreach to avoid single-point dependency.',
                'estimated_impact': 'HIGH'
            })

        # Semantic remediation scripts ready
        sgr = ei.get('semantic_gap_remediation', {}) or {}
        if sgr.get('script_count', 0) > 0:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Ready-to-Publish Assets',
                'finding': f'{sgr.get("script_count", 0)} JSON-LD + Markdown remediation assets auto-generated from your real gaps.',
                'action': 'Publish the FAQ schema pages and outreach briefs. Each published asset gives LLMs a new ground-truth node.',
                'estimated_impact': 'MEDIUM'
            })

        # SoMV trendline funnel insight
        trend = ei.get('somv_trendlines', {}) or {}
        for f in (trend.get('findings', []) or []):
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Funnel-Stage Visibility',
                'finding': f,
                'action': 'Re-balance content toward the weaker funnel stage shown above.',
                'estimated_impact': 'MEDIUM'
            })

        # Retrieval diagnostics: reformulation failures, not stupid models
        retr = ei.get('retrieval_diagnostics', {}) or {}
        for f in (retr.get('findings', []) or []):
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Retrieval Reformulation Failure',
                'finding': f,
                'action': 'Log hidden queries per response (dynamic_search_context.capture_hidden_queries) and tune allowed_domains, search_context_size, and query_templates until dead-query rate drops.',
                'estimated_impact': 'HIGH'
            })
        for dq in (retr.get('top_dead_queries', []) or [])[:3]:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Dead Retrieval Query',
                'finding': 'Engine query "%s" retrieved but never surfaced in citations (%d responses).' % (dq.get('query', ''), dq.get('count', 0)),
                'action': 'Check which domains that query returns on Google/Bing directly; add the missing authority nodes to your outreach list.',
                'estimated_impact': 'MEDIUM'
            })

        # Temporal drift: model re-index vs your site
        tdrift = ei.get('temporal_drift', {}) or {}
        for f in (tdrift.get('findings', []) or []):
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Model Re-index Drift',
                'finding': f,
                'action': 'Keep paired snapshot runs on a cadence; only rewrite content when BOTH snapshots move together.',
                'estimated_impact': 'MEDIUM'
            })

        # Agency savings on measured spend
        save = ei.get('agency_savings', {}) or {}
        if save.get('status') == 'measured':
            recommendations.append({
                'priority': 'INFO',
                'category': 'Cost Savings (Measured)',
                'finding': save.get('finding', ''),
                'action': 'Annualized run-rate savings: $%s-$%s vs retainer. Reinvest a fraction into review-gen + analyst briefings.' % (
                    '{:,.0f}'.format(save.get('annual_savings_range_usd', [0, 0])[0]),
                    '{:,.0f}'.format(save.get('annual_savings_range_usd', [0, 0])[1])),
                'estimated_impact': 'HIGH'
            })

        # ─── MODULE 10: Grounded-only honesty ───
        grounded = (somv.get('grounded_only', {}) or {})
        if grounded.get('grounded_share', 1) < 0.74:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Ungrounded Answers Inflating SoMV',
                'finding': f"Only {grounded.get('grounded_share', 0):.0%} of responses show browse evidence ({grounded.get('grounded_responses', 0)} grounded / {grounded.get('ungrounded_responses', 0)} memory). Reported SoMV mixes memory with retrieval.",
                'action': 'Switch the dashboard to grounded-only SoMV for decisions; treat ungrounded SoMV as pre-training popularity only.',
                'estimated_impact': 'HIGH'
            })
        for model_name, b in (grounded.get('browse_rate_by_model', {}) or {}).items():
            if b.get('flag') == 'LOW_BROWSE_RATE':
                recommendations.append({
                    'priority': 'MEDIUM',
                    'category': 'Low Browse Rate',
                    'finding': f"{model_name} browsed only {b.get('browse_rate', 0):.0%} of the time ({b.get('grounded')}/{b.get('total')}).",
                    'action': f'Force browsing for {model_name} (tool_choice required, search context high) or exclude it from grounded comparisons.',
                    'estimated_impact': 'MEDIUM'
                })

        # ─── MODULE 11: Volatility ───
        vol = results.get('volatility', {}) or {}
        if vol.get('status') == 'measured' and vol.get('summary', {}).get('unstable_share', 0) > 0.3:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Answer Volatility',
                'finding': f"{vol['summary']['unstable_share']:.0%} of money prompts flip leaders across repeats — point-estimate SoMV is theater.",
                'action': 'Publish CI-banded SoMV (Wilson 95%) and re-run volatile prompts 5x weekly; optimize pages cited in the winning repeat.',
                'estimated_impact': 'HIGH'
            })
        elif vol.get('status') == 'no_repeats':
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Volatility Not Measured',
                'finding': 'Money prompts ran once each — variance unknown (AIO shifts ~70% on repeat).',
                'action': 'Enable execution.volatility (repeats=5) for comparison/pricing prompts.',
                'estimated_impact': 'MEDIUM'
            })

        # ─── MODULE 12: Site audit ───
        site = results.get('site_audit', {}) or {}
        if site.get('status') == 'audited':
            if site.get('score', 100) < 70:
                recommendations.append({
                    'priority': 'HIGH',
                    'category': 'Site Not AI-Surfacing-Ready',
                    'finding': f"Technical site audit scored {site.get('score')}/100 (grade {site.get('grade')}).",
                    'action': 'Work the site_audit.fixes list top-down: snippet eligibility first, then JS-render, semantic HTML, JSON-LD, freshness.',
                    'estimated_impact': 'HIGH'
                })
            for fix in (site.get('fixes', []) or [])[:3]:
                recommendations.append({
                    'priority': 'MEDIUM', 'category': 'Site Fix',
                    'finding': fix if isinstance(fix, str) else str(fix),
                    'action': 'Implement on money pages first; re-audit after deploy.',
                    'estimated_impact': 'MEDIUM'
                })

        # ─── MODULE 13: Agent readiness ───
        agent = results.get('agent_readiness', {}) or {}
        if agent.get('status') == 'scored' and agent.get('score', 100) < 75:
            recommendations.append({
                'priority': 'MEDIUM',
                'category': 'Agent Readiness',
                'finding': f"Agent-readiness {agent.get('score')}/100 ({agent.get('verdict')}). llms.txt is NOT a Google factor — MCP/UCP/ACP are the gap.",
                'action': 'Ship MCP/WebMCP Tool Contract + UCP search_catalog (+ACP for shopping) before polishing llms.txt.',
                'estimated_impact': 'MEDIUM'
            })

        # ─── MODULE 14: Third-party dominance ───
        tpd = results.get('third_party_dominance', {}) or {}
        for brief in (tpd.get('outreach_briefs', []) or [])[:3]:
            recommendations.append({
                'priority': 'MEDIUM', 'category': f"Earned-Media Pack: {brief.get('pack')}",
                'finding': brief.get('brief', ''),
                'action': 'Execute the outreach brief: seed expert content on the pack domains and link to canonical facts pages.',
                'estimated_impact': 'MEDIUM'
            })

        # ─── MODULE 15: Snippet fail gate (P0) + Commerce Stage 0 (revenue) ───
        fg = (site.get('fail_gate', {}) or {})
        if fg.get('snippet_blocked'):
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Snippet-Blocked: AIO Visibility = 0',
                'finding': f"Snippet-blocked on {len(fg.get('blocked_pages', []))} page(s): {', '.join(fg.get('blocked_pages', [])[:3])}. Google applies nosnippet/max-snippet:0/data-nosnippet to AI Overviews/Mode too.",
                'action': 'Remove the blockers from answer content NOW, add scripts/snippet_gate.py to CI, and re-audit. Precedent: Meltwater May-2026 relaunch +73% citations (99k → 172k) in weeks.',
                'estimated_impact': 'HIGH'
            })
        commerce = results.get('commerce', {}) or {}
        sim = (commerce.get('feed_impact_simulator', {}) or {}).get('per_field', {}) or {}
        if sim:
            top = sorted(sim.items(), key=lambda kv: (-kv[1].get('est_carousel_lift_pts', 0), kv[0]))[:2]
            # 3.11-safe: no nested same-quote f-strings (PEP 701 is 3.12+; CI runs 3.11).
            top_bits = ', '.join(
                '%s +%s carousel eligibility' % (fname, '{:.0%}'.format(vals.get('est_carousel_lift_pts', 0)))
                for fname, vals in top
            )
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Feed Fix = Carousel Revenue',
                'finding': 'Top feed lifts: ' + top_bits + '. ~83% of ChatGPT carousels resolve to feed-backed listings.',
                'action': 'Apply reports/commerce_fixes/merchant_feed_fix.csv, publish Product Offer JSON-LD, probe ACP via scripts/acp_probe.js --cron.',
                'estimated_impact': 'HIGH'
            })
        traffic = results.get('traffic_join', {}) or {}
        roi = traffic.get('roi_line', {}) or {}
        if roi.get('ai_revenue_share') not in (None, 0, 'n/a'):
            recommendations.append({
                'priority': 'MEDIUM', 'category': 'Revenue Proof',
                'finding': f"AI-referrer revenue share {roi.get('ai_revenue_share')} with conversion rate {roi.get('ai_conversion_rate')} — SoMV now ties to pipeline.",
                'action': 'Import fresh GSC/GA4/Bing exports monthly (scripts/import_traffic.py) and refresh the Looker Studio CEO page.',
                'estimated_impact': 'MEDIUM'
            })

        # ─── CROSS-MODULE INSIGHTS ───
        # Combined negative signal
        if neg_triples and high_biases:
            recommendations.append({
                'priority': 'HIGH',
                'category': 'Compound Risk Alert',
                'finding': f'{brand_display} faces COMPOUND risk: {len(unique_neg)} negative claims + {len(high_biases)} HIGH-severity biases. Together these create a strongly negative AI perception.',
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
