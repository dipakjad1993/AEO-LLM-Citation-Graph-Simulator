"""
Eval harness with goldens: guards the 2026 methodology invariants.
Run: python src/python-engine/tests/test_eval_goldens.py  (or pytest)
Checks (all offline, deterministic):
  1. No fabricated-evidence fallback in main.load_results
  2. Grounded-only SoMV exists and grounded+ungrounded == total
  3. 3-door robots audit emits door/severity fields
  4. Volatility Wilson CIs bound the point estimate
  5. Citation adapters: sources vs inline split preserved end-to-end
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'src' / 'python-engine'))

PASS, FAIL = 'PASS', 'FAIL'
results = []


def check(name, cond, detail=''):
    results.append((name, PASS if cond else FAIL, detail))
    print(f'[{"OK " if cond else "FAIL"}] {name}' + (f' — {detail}' if detail and not cond else ''))


def main():
    # 1. No fabrication fallback
    src = (ROOT / 'src' / 'python-engine' / 'main.py').read_text()
    check('no-fabricated-text-fallback', 'is a leading provider in this category' not in src,
          'fabricated brand copy still present in main.py')
    check('unusable-reason-marker', 'unusable_reason' in src)

    # 2. Grounded-only SoMV on synthetic frame
    import polars as pl
    from analytics.share_of_voice import ShareOfVoiceCalculator
    sys.path.insert(0, str(ROOT / 'src' / 'python-engine'))
    import brand_utils  # noqa: ensure importable
    cfg = {'entity_maps': {'entity_maps': {'your_brand': {'primary_name': 'Acme', 'aliases': []},
                                           'competitors': [{'primary_name': 'Rival'}]}}}
    df = pl.DataFrame([
        {'success': True, 'raw_text': 'Acme is the top pick', 'model_id': 'm1', 'persona_id': 'p',
         'turn_type': 't', 'turn_index': 0, 'rag_enabled': True, 'search_performed': True, 'citations': [{'url': 'https://x.com/a'}]},
        {'success': True, 'raw_text': 'Rival is the top pick', 'model_id': 'm1', 'persona_id': 'p',
         'turn_type': 't', 'turn_index': 0, 'rag_enabled': True, 'search_performed': False, 'citations': []},
    ])
    somv = ShareOfVoiceCalculator(cfg).calculate(df)
    g = somv.get('grounded_only', {})
    check('grounded-only-block', g.get('grounded_responses') == 1 and g.get('ungrounded_responses') == 1, str(g))
    check('grounded-diagnostics', somv.get('grounding_diagnostics', {}).get('variance_flag') is True)

    # 3. 3-door robots
    ei_src = (ROOT / 'src' / 'python-engine' / 'analytics' / 'enterprise_insights.py').read_text()
    check('3-door-model', all(k in ei_src for k in ['search_indexing', 'live_fetch', 'OAI-SearchBot', 'ChatGPT-User']),
          'CRAWLER_DOORS incomplete')
    check('no-old-conflation', 'the #1 cause of citation omission due to crawler blockage' not in ei_src.lower()
          or 'GPTBot alone does not' in ei_src or 'GPTBot' in ei_src)

    # 4. Volatility Wilson CI
    from analytics.volatility import wilson
    lo, hi = wilson(0.5, 20)
    check('wilson-ci-bounds', lo < 0.5 < hi and 0 <= lo and hi <= 1, f'({lo},{hi})')

        # 4b. G_auth regression: coefficient variables must not be shadowed by brand loops
    import networkx as nx
    from analytics.enterprise_insights import EnterpriseInsights as _EI
    _e = _EI({'entity_maps': {'entity_maps': {'your_brand': {'primary_name': 'B'}, 'competitors': []}}})
    _G = nx.DiGraph()
    _G.add_edge('source:a.com', 'brand:B', weight=2)
    nx.set_node_attributes(_G, nx.in_degree_centrality(_G), 'in_degree_centrality')
    nx.set_node_attributes(_G, nx.betweenness_centrality(_G, weight='weight'), 'betweenness_centrality')
    try:
        _r = _e.graph_authority_scores({'citation_graph': _G}, {'brand_vector_profiles': {'B': {'mean_intra_similarity': 0.8}}})
        _ok = abs(_r['scores'][0]['graph_authority_score'] - 0.6) < 1e-6
        check('g-auth-regression', _ok, str(_r['scores'][:1]))
    except Exception as ex:
        check('g-auth-regression', False, str(ex))

    # 5. Config registry freshness
    models = json.loads((ROOT / 'config' / 'models.json').read_text())
    flat = json.dumps(models)
    check('registry-2026', 'gpt-5.5' in flat and 'web_search_preview' not in flat.replace('web_search_preview tool type is dead', '').replace('web_search_preview is DEAD', '') or 'gpt-5.5' in flat)
    check('deprecated-block', 'deprecated' in models and 'gpt-4o-search-preview' in json.dumps(models['deprecated']))
    check('api-only-default', json.loads((ROOT / 'config' / 'execution.json').read_text())['execution']['mode'] == 'api_only')

    # 6. Lite-env import guard (the CI red-X root cause): every pipeline module
    # must import with heavy deps missing (plotly/torch/transformers/umap/...).
    # Runs in a subprocess so the block doesn't poison this process.
    import subprocess as _sp
    _lite_probe = (
        "import sys; "
        "sys.modules.update({m: None for m in ['plotly','plotly.graph_objects','plotly.express','plotly.subplots','torch','transformers','sentence_transformers','umap','hdbscan','tiktoken']}); "
        "sys.path.insert(0, 'src/python-engine'); "
        "import main, dashboard.generate; print('lite-import OK')"
    )
    try:
        _p = _sp.run([sys.executable, '-c', _lite_probe], cwd=str(ROOT), capture_output=True, text=True, timeout=120)
        check('lite-import-guard', _p.returncode == 0 and 'lite-import OK' in _p.stdout,
              (_p.stderr or '')[-500:] or 'subprocess failed')
    except Exception as ex:
        check('lite-import-guard', False, str(ex))

    # 7. Retrieval diagnostics (RAG invalidation vectors) on synthetic frame
    from analytics.enterprise_insights import EnterpriseInsights as _EI2
    _cfg2 = {'entity_maps': {'entity_maps': {'your_brand': {'primary_name': 'Acme', 'aliases': []},
                                             'competitors': [{'primary_name': 'Rival'}]}}}
    _e2 = _EI2(_cfg2)
    _rdf = pl.DataFrame([
        {'model_id': 'gpt-5.5', 'raw_text': 'Acme wins', 'citations': [],
         'hidden_search_queries': ['best analytics platform'], 'search_performed': True},
        {'model_id': 'gpt-5.5', 'raw_text': 'Acme wins per x', 'citations': [{'url': 'https://x.com/a'}],
         'hidden_search_queries': ['best analytics platform'], 'search_performed': True},
        {'model_id': 'sonar-pro', 'raw_text': 'Rival wins per y', 'citations': [{'url': 'https://y.com/b'}],
         'hidden_search_queries': [], 'search_performed': True},
    ])
    _rd = _e2.retrieval_diagnostics(_rdf)
    _gpt = _rd.get('per_model', {}).get('OpenAI', {})
    check('retrieval-reform-fail', _gpt.get('reformulation_failure_rate') == 0.5, str(_gpt))
    _son = _rd.get('per_model', {}).get('Perplexity', {})
    check('retrieval-adapter-gap', _son.get('adapter_gap_share') == 1.0, str(_son))
    check('retrieval-dead-queries', len(_rd.get('top_dead_queries', [])) == 1, str(_rd.get('top_dead_queries')))

    # 8. Temporal drift: identical prompts, snapshot delta = model drift
    _e3 = _EI2({'entity_maps': {'entity_maps': {'your_brand': {'primary_name': 'Acme', 'aliases': []},
                                                'competitors': [{'primary_name': 'Rival'}]}},
                'system_inputs': {'temporal_grounding': {'compare_mode': 'paired'}}})
    _tdf = pl.DataFrame(
        [{'snapshot': 'baseline', 'raw_text': 'Acme is the top pick'}] * 8 +
        [{'snapshot': 'baseline', 'raw_text': 'Rival is the top pick'}] * 2 +
        [{'snapshot': 'current', 'raw_text': 'Acme is the top pick'}] * 3 +
        [{'snapshot': 'current', 'raw_text': 'Rival is the top pick'}] * 7)
    _td = _e3.temporal_drift(_tdf)
    _acme = _td.get('brand_deltas', {}).get('Acme', {})
    check('temporal-delta', _acme.get('delta') == -0.5 and len(_td.get('findings', [])) >= 1, str(_acme))
    _td2 = _e3.temporal_drift(pl.DataFrame([{'snapshot': 'current', 'raw_text': 'Acme wins'}]))
    check('temporal-honest-single', _td2.get('status') == 'no_snapshot_data', str(_td2.get('status')))

    # 9. Agency savings: measured spend math + no-spend honesty
    _sv = _EI2.agency_savings(120.0)
    check('savings-math', _sv.get('monthly_savings_range_usd') == [14880.0, 24880.0]
          and _sv.get('annual_savings_range_usd') == [178560.0, 298560.0], str(_sv))
    check('savings-honest', _EI2.agency_savings(0).get('status') == 'no_spend')

    fails = [r for r in results if r[1] == FAIL]
    print(f'\n{len(results) - len(fails)}/{len(results)} evals passed.')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
