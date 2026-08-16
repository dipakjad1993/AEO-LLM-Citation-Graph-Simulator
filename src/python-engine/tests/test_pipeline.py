"""
AEO Citation Graph Simulator - Real Configuration Validator
Validates that the pipeline is ready to process REAL data.
Does NOT use any mock/synthetic data.
"""

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR / 'src' / 'python-engine'))


def validate_entity_config():
    """Ensure entity_maps.json has real brand data."""
    config_path = ROOT_DIR / 'config' / 'entity_maps.json'
    if not config_path.exists():
        print("FAIL: config/entity_maps.json not found")
        return False

    with open(config_path) as f:
        config = json.load(f)

    entity_maps = config.get('entity_maps', {})
    your_brand = entity_maps.get('your_brand', {})

    if not your_brand.get('primary_name'):
        print("FAIL: your_brand.primary_name is empty. Fill in config/entity_maps.json with YOUR brand name.")
        return False

    competitors = entity_maps.get('competitors', [])
    if not competitors:
        print("FAIL: No competitors configured. Add at least one competitor to entity_maps.json.")
        return False

    print(f"PASS: Primary brand = {your_brand['primary_name']}")
    print(f"PASS: {len(competitors)} competitor(s) configured")
    return True


def validate_analytics_imports():
    """Ensure analytics modules can be imported."""
    try:
        from pipeline.attribution_split import AttributionClassifier
        from pipeline.triple_extractor import TripleExtractor
        from analytics.citation_graph import CitationGraphBuilder
        from analytics.sentiment_matrix import SentimentMatrix
        from analytics.share_of_voice import ShareOfVoiceCalculator
        from dashboard.generate import DashboardGenerator
        print("PASS: All analytics modules import successfully")
        return True
    except ImportError as e:
        print(f"FAIL: Import error - {e}")
        return False


def validate_no_synthetic_files():
    """Ensure synthetic data generators have been removed."""
    synthetic_files = [
        ROOT_DIR / 'src' / 'python-engine' / 'generate_sample_data.py',
        ROOT_DIR / 'src' / 'python-engine' / 'produce_sample_data.py',
        ROOT_DIR / 'src' / 'python-engine' / 'produce_sample_inputs.py',
        ROOT_DIR / 'data' / 'samples',
    ]

    all_clean = True
    for p in synthetic_files:
        if p.exists():
            print(f"FAIL: Synthetic artifact still exists: {p}")
            all_clean = False

    if all_clean:
        print("PASS: No synthetic data artifacts found")
    return all_clean


def validate_real_results_required():
    """Ensure pipeline requires real input data."""
    results_dir = ROOT_DIR / 'data' / 'output'

    if not results_dir.exists():
        print("PASS: No output directory yet (will be created when you run the orchestrator)")
        return True

    result_files = list(results_dir.glob('*/extracted_data/all_results.json'))
    if result_files:
        print(f"INFO: Found {len(result_files)} existing result file(s) that can be analyzed")
    else:
        print("INFO: No result files found yet. Run the orchestrator first to collect real LLM data.")

    return True


def main():
    print("=" * 60)
    print("  AEO Citation Graph Simulator - Real Configuration Validator")
    print("=" * 60 + "\n")

    results = {}
    results['entity_config'] = validate_entity_config()
    results['analytics_imports'] = validate_analytics_imports()
    results['no_synthetic'] = validate_no_synthetic_files()
    results['results_check'] = validate_real_results_required()

    print("\n" + "=" * 60)
    print("  VALIDATION RESULTS")
    print("=" * 60)

    all_passed = True
    for test, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  {status}  {test}")
        if not passed:
            all_passed = False

    print("\n" + "=" * 60)
    if all_passed:
        print("  ALL CHECKS PASSED - Ready for real data analysis")
    else:
        print("  SOME CHECKS FAILED - Fix issues above before running")
    print("=" * 60 + "\n")

    return 0 if all_passed else 1


if __name__ == '__main__':
    sys.exit(main())
