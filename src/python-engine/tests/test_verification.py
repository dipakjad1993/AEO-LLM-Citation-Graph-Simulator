"""
Ground-Truth Claim Verification — unit tests.
Runs fully offline (embedder disabled) against small, explicitly-labelled test
fixtures to prove the verification engine labels claims correctly.
Run: python src/python-engine/tests/test_verification.py
"""

import json
import sys
import tempfile
from pathlib import Path

import polars as pl

ROOT_DIR = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR / 'src' / 'python-engine'))

from pipeline.verification import GroundTruthClaimVerifier  # noqa: E402


def make_config():
    return {
        'entity_maps': {
            'entity_maps': {
                'your_brand': {
                    'primary_name': 'Acme Cloud',
                    'attributes': {
                        'features': ['SOC 2 certified', '99.99% uptime SLA'],
                        'pricing_model': 'free tier with paid plans from $10/month',
                        'certifications': ['SOC 2 Type II'],
                        'unique_selling_points': ['serverless autoscaling']
                    }
                },
                'competitors': []
            }
        },
        'analytics': {
            'verification': {
                'enabled': True,
                'use_embeddings': False,
                'embedding': {'model': 'all-mpnet-base-v2'}
            }
        },
        'execution': {}
    }


def make_df():
    rows = [
        {
            'model_id': 'gpt-4o', 'persona_id': 'p1', 'rag_enabled': True,
            'primary_brand_mention': 'Acme Cloud',
            'raw_text': 'Acme Cloud offers SOC 2 certified and a free tier with paid plans from $10 per month.',
            'triples': [
                {'subject': 'Acme Cloud', 'predicate': 'offers', 'object': 'SOC 2 certified', 'brand': 'Acme Cloud'},
                {'subject': 'Acme Cloud', 'predicate': 'has', 'object': 'free tier with paid plans from $10/month', 'brand': 'Acme Cloud'}
            ]
        },
        {
            'model_id': 'claude-3-5-sonnet', 'persona_id': 'p2', 'rag_enabled': True,
            'primary_brand_mention': 'Acme Cloud',
            'raw_text': 'Acme Cloud is not SOC 2 certified and has no free tier.',
            'triples': [
                {'subject': 'Acme Cloud', 'predicate': 'is not', 'object': 'SOC 2 certified', 'brand': 'Acme Cloud'}
            ]
        },
        {
            'model_id': 'gemini-1.5-pro', 'persona_id': 'p3', 'rag_enabled': False,
            'primary_brand_mention': 'Acme Cloud',
            'raw_text': 'Acme Cloud pricing is available in Europe with dedicated infrastructure.',
            'triples': [
                {'subject': 'Acme Cloud', 'predicate': 'has', 'object': 'pricing in Europe', 'brand': 'Acme Cloud'}
            ]
        }
    ]
    return pl.DataFrame(rows)


def main():
    failures = []

    def check(name, cond):
        status = 'PASS' if cond else 'FAIL'
        print(f'  {status}  {name}')
        if not cond:
            failures.append(name)

    print('=' * 60)
    print('  Ground-Truth Claim Verification - Unit Tests')
    print('=' * 60)

    config = make_config()

    print('\n[1] Verification with ground-truth corpus')
    verifier = GroundTruthClaimVerifier(config, run_dir=None)
    check('ground truth loaded from entity_maps attributes',
          len(verifier.ground_truth) >= 4)
    check('ground truth contains brand_ground_truth domain',
          any(gt['domain'] == 'brand_ground_truth' for gt in verifier.ground_truth))

    df, report = verifier.verify(make_df())
    overall = report['overall']
    check('report claims extracted', report['claims_extracted'] == 4)
    check('report verification_ran True', report['verification_ran'] is True)
    check('verified claims counted', overall['verified'] >= 2)
    check('contradicted claims detected', overall['contradicted'] >= 1)
    check('per-model aggregation present', len(report['by_model']) >= 3)
    check('contradicted_claims detail has evidence',
          any(c.get('evidence') for c in report['contradicted_claims']))
    check('df has claim_verification column', 'claim_verification' in df.columns)
    check('df has verified_claim_count column', 'verified_claim_count' in df.columns)
    contradiction_row = df.filter(pl.col('model_id') == 'claude-3-5-sonnet')
    check('contradicting model flagged in dataframe',
          contradiction_row['claim_verification'][0][0]['label'] == 'contradicted')

    print('\n[2] No ground-truth corpus (honest unverified reporting)')
    empty_config = {
        'entity_maps': {'entity_maps': {'your_brand': {'primary_name': 'X'}, 'competitors': []}},
        'analytics': {'verification': {'use_embeddings': False}},
        'execution': {}
    }
    empty_verifier = GroundTruthClaimVerifier(empty_config, run_dir=None)
    check('corpus empty for empty config', len(empty_verifier.ground_truth) == 0)
    df2, report2 = empty_verifier.verify(make_df())
    check('no-corpus run reports unverified', report2['verification_ran'] is False)
    check('all claims labelled unverified when no corpus',
          report2['overall']['unverified'] == report2['overall']['total_claims'])
    check('honest message present',
          'No ground-truth corpus' in report2.get('message', ''))

    print('\n[3] Uploaded gold-standard corpus loading')
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        (td_path / 'uploaded_gold_standards').mkdir()
        (td_path / 'uploaded_gold_standards' / 'facts.txt').write_text(
            'Acme Cloud is SOC 2 certified and provides 99.99% uptime.', encoding='utf-8')
        verifier3 = GroundTruthClaimVerifier(config, run_dir=td)
        check('uploaded gold standard loaded',
              any('gold_standard' in gt['source'] for gt in verifier3.ground_truth))

    print('\n' + '=' * 60)
    if failures:
        print(f'  {len(failures)} FAILED TEST(S): {", ".join(failures)}')
        print('=' * 60)
        return 1
    print('  ALL CHECKS PASSED')
    print('=' * 60)
    return 0


if __name__ == '__main__':
    sys.exit(main())
