"""
Seed a keyless demo dataset: writes data/output/run_demo/extracted_data/all_results.json
with synthetic multi-model, multi-turn, citation-bearing responses, then runs the
full 14-stage pipeline. `npm run demo` / `python seed_demo_data.py --run`.
No API keys. No fabrication in real paths — this file is clearly labelled demo.
"""
import json
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
random.seed(42)

BRAND = 'Acme Analytics'
COMPS = ['RivalOne', 'RivalTwo']
MODELS = ['gpt-5-5', 'claude-4-sonnet', 'gemini-2-5-pro', 'sonar-pro', 'deepseek-v3', 'grok-4', 'google-ai-overviews']
PERSONAS = ['technical_buyer', 'business_buyer', 'procurement_buyer']
TURNS = ['category_discovery', 'feature_deep_dive', 'comparison_analysis', 'objection_compliance', 'pricing_procurement']
DOMAINS = ['gartner.com', 'reddit.com', 'youtube.com', 'g2.com', 'techcrunch.com', 'docs.acme.example.com']


def make_text(leader: str, turn: str) -> str:
    if turn == 'category_discovery':
        return (f'Based on current analyst reviews, the top shortlist is {leader}, followed by {COMPS[0]} and {COMPS[1]}. '
                f'{BRAND} is a leading provider with strong documentation and verified customer reviews.')
    if turn == 'comparison_analysis':
        return (f'Comparing {BRAND} vs {COMPS[0]}: {leader} is the recommended choice for enterprise deployment. '
                f'{BRAND} offers audited dashboards while {COMPS[0]} competes on price.')
    if turn == 'objection_compliance':
        return (f'Known limitations: {COMPS[1]} had a 2025 outage reviewed on Reddit. {BRAND} holds SOC2 with no major incidents reported.')
    if turn == 'pricing_procurement':
        return (f'{BRAND} pricing is SaaS per-seat; {COMPS[0]} is cheaper upfront but add-ons raise TCO. Analysts recommend {leader} for regulated buyers.')
    return (f'{BRAND} handles core capabilities with step-by-step docs. {leader} leads this evaluation; see official documentation.')


def main():
    run_dir = ROOT / 'data' / 'output' / 'run_demo'
    exdir = run_dir / 'extracted_data'
    exdir.mkdir(parents=True, exist_ok=True)
    rows = []
    eid = 0
    for persona in PERSONAS:
        for pi in range(2):
            sess = f'demo-session-{persona}-{pi}'
            for turn_idx, turn in enumerate(TURNS[:3]):
                for model in MODELS:
                    leader = random.choice([BRAND] + COMPS)
                    grounded = model != 'deepseek-v3'
                    cites = [{'url': f'https://{d}/demo-article-{eid}', 'title': d, 'snippet': 'demo citation'} for d in random.sample(DOMAINS, 2)] if grounded else []
                    rows.append({
                        'executionId': f'demo-{eid}', 'promptSessionId': sess, 'personaId': persona,
                        'demo_synthetic': True, 'synthetic_reason': 'seed_demo_data.py keyless demo corpus — never prod evidence',
                        'modelId': model, 'provider': model.split('-')[0], 'turnIndex': turn_idx, 'turnType': turn,
                        'prompt': f'Demo prompt {turn} {pi}', 'ragEnabled': grounded,
                        'channel': 'api', 'search_performed': grounded, 'search_requested': True,
                        'ungrounded': not grounded, 'grounding': 'grounded' if grounded else 'ungrounded_memory',
                        'volatilityRep': 0, 'serp_surface': 'aio_serp_grounded' if model == 'google-ai-overviews' else None,
                        'result': {'raw_text': make_text(leader, turn), 'citations': cites,
                                   'sources': cites, 'inline_citations': cites[:1],
                                   'hidden_search_queries': [f'demo query {turn}'] if grounded else []},
                        'status': 'fulfilled', 'timestamp': datetime.now(timezone.utc).isoformat(),
                    })
                    eid += 1
                    # attribution-split twin (RAG off) for turn 0
                    if turn_idx == 0:
                        rows.append({**rows[-1], 'executionId': f'demo-{eid}', 'ragEnabled': False,
                                     'search_performed': False, 'ungrounded': True, 'grounding': 'base_weights',
                                     'result': {**rows[-1]['result'], 'citations': [], 'sources': [], 'inline_citations': []}})
                        eid += 1
    with open(exdir / 'all_results.json', 'w') as f:
        json.dump(rows, f, indent=2)
    print(f'Seeded {len(rows)} demo rows -> {exdir / "all_results.json"}')
    if '--run' in sys.argv:
        import os
        import subprocess
        # Explicit opt-in: the demo corpus is labelled demo_synthetic and the prod
        # loader quarantines such rows UNLESS AEO_ALLOW_SYNTHETIC=1. The demo sets it
        # for its own run only — real run_* dirs never get this flag.
        env = dict(os.environ, AEO_ALLOW_SYNTHETIC='1')
        r = subprocess.run([sys.executable, str(ROOT / 'src' / 'python-engine' / 'main.py'), '--run-dir', str(run_dir)],
                           cwd=str(ROOT), env=env)
        sys.exit(r.returncode)


if __name__ == '__main__':
    t0 = time.time()
    main()
    print(f'done in {time.time()-t0:.1f}s')
