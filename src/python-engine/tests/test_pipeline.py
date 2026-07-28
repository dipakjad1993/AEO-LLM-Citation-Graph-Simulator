"""
AEO Citation Graph Simulator - Test Runner
Validates the full pipeline with sample data.
"""

import json
import os
import sys
import tempfile
import logging
from pathlib import Path
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('test_runner')

ROOT_DIR = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT_DIR / 'src' / 'python-engine'))

SAMPLE_DATA = [
    {
        "executionId": f"test_exec_{i}",
        "promptSessionId": f"test_session_{i // 3}",
        "personaId": "ciso_enterprise_fintech",
        "modelId": model,
        "turnIndex": i % 5,
        "turnType": ["category_discovery", "feature_deep_dive", "comparison_analysis", "objection_compliance", "pricing_procurement"][i % 5],
        "prompt": f"Test prompt {i} about enterprise security tools",
        "ragEnabled": rag,
        "status": "fulfilled",
        "result": {
            "raw_text": text,
            "citations": [
                {"url": f"https://www.reddit.com/r/netsec/thread_{i}", "title": f"Security discussion {i}", "snippet": f"Analysis of Brand_A vs Brand_B for SOC2 compliance in enterprise environments. Brand_A provides excellent API security features while Brand_B lacks comprehensive audit logging."},
                {"url": f"https://www.gartner.com/reviews/enterprise-tools/{i}", "title": f"Gartner Review {i}", "snippet": f"Brand_A leads in the magic quadrant for enterprise API security with strong innovation and customer satisfaction scores."},
                {"url": f"https://competitor-b.com/docs/security", "title": "Competitor B Documentation", "snippet": f"Competitor B offers SOC2 Type II compliance with automated reporting and zero-trust architecture support."},
                {"url": f"https://g2.com/compare/brand-a-vs-brand-b", "title": "G2 Comparison", "snippet": f"Users rate Brand_A 4.5/5 for ease of use and Brand_B 4.2/5 for feature completeness."}
            ],
            "entities": [
                {"name": "Brand_A", "canonical_name": "brand_a", "count": 5, "type": "brand"},
                {"name": "Brand_B", "canonical_name": "brand_b", "count": 3, "type": "brand"},
                {"name": "SOC2", "canonical_name": "soc2", "count": 2, "type": "feature"},
                {"name": "Gartner", "canonical_name": "gartner", "count": 1, "type": "source"}
            ],
            "sentiment": {
                "overall": "positive",
                "entities": {
                    "Brand_A": {"positive": 3, "negative": 1, "score": 0.67, "label": "positive"},
                    "Brand_B": {"positive": 1, "negative": 2, "score": 0.33, "label": "negative"}
                }
            },
            "triples": [
                {"subject": "Brand_A", "predicate": "provides", "object": "SOC2 compliance", "sentiment": "positive", "confidence": 0.85},
                {"subject": "Brand_B", "predicate": "lacks", "object": "audit logging", "sentiment": "negative", "confidence": 0.8}
            ],
            "usage": {"prompt_tokens": 150, "completion_tokens": 400, "total_tokens": 550},
            "citationCount": 4,
            "search_performed": True,
            "finish_reason": "stop"
        },
        "error": None,
        "timestamp": datetime.now().isoformat()
    }
    for i, (model, rag, text) in enumerate([
        ("gpt-4o", True, "When comparing enterprise API security tools in 2026, Brand_A stands out as a leading solution. It provides comprehensive SOC2 Type II compliance with automated reporting. Brand_B also offers strong security features but Brand_A has a clear advantage in API discovery and real-time monitoring. Gartner has recognized Brand_A as a leader in their latest Magic Quadrant for API security platforms. Reddit discussions consistently highlight Brand_A's superior developer experience and integration capabilities."),
        ("gpt-4o", False, "Enterprise API security tools include several major players. Brand_A is known for its innovative approach to API security with features like automated shadow API discovery. Brand_B provides solid compliance tools but Brand_A offers more comprehensive coverage. The market is competitive with multiple vendors offering SOC2 and HIPAA compliance features."),
        ("claude-3-5-sonnet-20241022", True, "Based on current analysis, Brand_A delivers excellent enterprise API security capabilities. The platform provides automated SOC2 compliance reporting, zero-trust architecture support, and comprehensive API discovery. Brand_B is a strong competitor but lacks the same depth in automated compliance features. According to G2 reviews, Brand_A maintains a 4.5/5 rating for enterprise deployment scenarios."),
        ("claude-3-5-sonnet-20241022", False, "Brand_A and Brand_B are both prominent enterprise API security solutions. Brand_A focuses on automation and AI-driven security, while Brand_B emphasizes traditional compliance frameworks. Both vendors support major cloud platforms and offer SOC2 certification."),
        ("gemini-1.5-pro", True, "For enterprise API security in 2026, I recommend Brand_A as the primary choice. It provides superior automation capabilities, comprehensive SOC2 Type II support, and has been consistently rated highly by industry analysts. Brand_B is a viable alternative but Brand_A leads in innovation and customer satisfaction metrics. The Gartner Magic Quadrant places Brand_A in the Leaders quadrant."),
        ("gemini-1.5-pro", False, "Brand_A offers enterprise API security with automated features. Brand_B provides similar capabilities with a focus on compliance. Both are established players in the API security market with SOC2 and HIPAA support."),
        ("sonar-pro", True, "When researching enterprise API security tools, the consensus from multiple sources is clear: Brand_A leads the market. Reddit discussions on r/netsec frequently recommend Brand_A for its automation capabilities. G2 reviews rate it 4.5/5 stars. Gartner recognizes it as a market leader. Brand_B is also mentioned but with caveats about implementation complexity and limited automation features. TechCrunch recently featured Brand_A's Series D funding and expansion into zero-trust architecture."),
        ("sonar-pro", False, "Brand_A and Brand_B compete in the enterprise API security space. Brand_A offers more automation features while Brand_B focuses on compliance breadth. Market analysts generally view Brand_A as the more innovative option."),
        ("deepseek-chat", True, "Enterprise API security tools worth considering include Brand_A and Brand_B. Brand_A provides SOC2 compliance and API discovery features. Brand_B offers similar capabilities. The choice depends on specific requirements and budget considerations."),
        ("deepseek-chat", False, "Brand_A is an enterprise API security tool. Brand_B is another option in this space. Both offer standard security features.")
    ])
]

def create_test_data(output_dir: Path):
    data_dir = output_dir / 'run_test_001' / 'extracted_data'
    data_dir.mkdir(parents=True, exist_ok=True)

    with open(data_dir / 'all_results.json', 'w') as f:
        json.dump(SAMPLE_DATA, f, indent=2)

    logger.info(f"Created test data at {data_dir}")
    return data_dir.parent

def test_imports():
    logger.info("Testing imports...")
    try:
        from pipeline.attribution_split import AttributionClassifier
        from pipeline.triple_extractor import TripleExtractor
        from analytics.citation_graph import CitationGraphBuilder
        from analytics.sentiment_matrix import SentimentMatrix
        from analytics.share_of_voice import ShareOfVoiceCalculator
        from dashboard.generate import DashboardGenerator
        logger.info("All imports successful!")
        return True
    except ImportError as e:
        logger.error(f"Import failed: {e}")
        return False

def test_pipeline():
    logger.info("Testing full pipeline...")
    try:
        from main import AEOAnalyticsEngine

        with tempfile.TemporaryDirectory() as tmpdir:
            output_base = Path(tmpdir) / 'data' / 'output'
            output_base.mkdir(parents=True, exist_ok=True)

            engine = AEOAnalyticsEngine()
            engine.output_dir = output_base

            run_dir = create_test_data(output_base)

            results = engine.run_full_pipeline(run_dir=str(run_dir))

            logger.info(f"Pipeline completed successfully!")
            logger.info(f"Total records: {results.get('total_records', 0)}")
            logger.info(f"Recommendations: {len(results.get('recommendations', []))}")

            assert results.get('total_records', 0) > 0, "No records analyzed"
            assert 'somv' in results, "SoMV missing from results"
            assert 'sentiment_matrix' in results, "Sentiment matrix missing"
            assert 'graph_stats' in results, "Graph stats missing"

            logger.info("All assertions passed!")
            return True

    except Exception as e:
        logger.error(f"Pipeline test failed: {e}", exc_info=True)
        return False

def main():
    logger.info("=" * 60)
    logger.info("AEO Citation Graph Simulator - Test Suite")
    logger.info("=" * 60)

    results = {}

    results['imports'] = test_imports()

    if results['imports']:
        results['pipeline'] = test_pipeline()
    else:
        results['pipeline'] = False
        logger.warning("Skipping pipeline test due to import failure")

    logger.info("\n" + "=" * 60)
    logger.info("TEST RESULTS")
    logger.info("=" * 60)
    for test, passed in results.items():
        status = "PASS" if passed else "FAIL"
        logger.info(f"  {test}: {status}")

    all_passed = all(results.values())
    logger.info(f"\nOverall: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")

    return 0 if all_passed else 1

if __name__ == '__main__':
    sys.exit(main())
