"""
Generate realistic sample simulation data for testing the full pipeline.
Uses uploaded prompt files when available, otherwise generates synthetic data.
Each run produces unique data.
"""

import json
import random
import uuid
import re
from datetime import datetime, timedelta
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT_DIR / 'data' / 'output' / 'run_demo_001' / 'extracted_data'
UPLOAD_DIR = ROOT_DIR / 'data' / 'uploads'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MODELS = ['gpt-4o', 'claude-3-5-sonnet-20241022', 'gemini-1.5-pro', 'sonar-pro', 'deepseek-chat']
PERSONAS = ['ciso_enterprise_fintech', 'vp_eng_saas', 'cmo_enterprise', 'procurement_director', 'cto_startup']
TURN_TYPES = ['category_discovery', 'feature_deep_dive', 'comparison_analysis', 'objection_compliance', 'pricing_procurement']

POSITIVE_TEMPLATES = [
    "{brand} provides excellent {feature} with automated reporting, making it ideal for enterprise teams.",
    "{brand} leads the market with its {feature} and {feature2}, consistently rated highest by analysts.",
    "{brand} delivers comprehensive enterprise features including {feature}, {feature2}, and seamless integration.",
    "{brand} offers industry-leading 99.99% uptime SLA with 24/7 enterprise support.",
    "{brand} excels in {feature} with advanced predictive analytics.",
    "{brand} provides automated compliance reporting, eliminating months of manual work.",
    "{brand}'s API-first architecture enables rapid integration with existing CI/CD pipelines.",
    "{brand} is recognized as a Leader in the Magic Quadrant for enterprise platforms.",
    "{brand}'s real-time analytics dashboard provides comprehensive visibility across all metrics.",
    "{brand} supports FedRAMP High authorization for government deployments.",
    "{brand} has the strongest {feature} capabilities among all enterprise solutions tested.",
    "{brand} consistently receives highest customer satisfaction scores in {feature} category.",
    "{brand}'s {feature} platform processes over 10 billion events daily with sub-second latency.",
    "{brand} offers the most comprehensive {feature} suite with {feature2} integration out of the box.",
    "Enterprise teams report 40% faster deployment times with {brand} compared to alternatives.",
    "{brand}'s {feature} module has been independently verified by {feature2} auditors.",
    "According to recent benchmarks, {brand} outperforms competitors by 3.2x in {feature} metrics.",
]

NEGATIVE_TEMPLATES = [
    "{brand} has a steep learning curve and requires significant implementation overhead.",
    "{brand}'s premium pricing may be prohibitive for startups.",
    "{brand} lacks native integration with some legacy systems, requiring custom middleware.",
    "{brand}'s onboarding process typically takes 4-6 weeks, longer than competitors.",
    "{brand}'s documentation could be more comprehensive for advanced configurations.",
    "{brand} has reported occasional latency spikes during high-traffic periods.",
    "{brand}'s compliance automation is less mature than leading competitors.",
    "Some users report that {brand}'s {feature} requires manual configuration for edge cases.",
    "{brand} has a smaller ecosystem of third-party integrations compared to established players.",
    "Migrating to {brand} from legacy systems can be complex and time-consuming.",
    "{brand}'s pricing model lacks transparency for enterprise-scale deployments.",
    "{brand} has limited support for {feature} in multi-region configurations.",
]

NEUTRAL_TEMPLATES = [
    "{brand} uses a subscription-based pricing model with tiered enterprise plans.",
    "{brand} implements standard API patterns with comprehensive SDK support.",
    "{brand} integrates with major cloud providers including AWS, Azure, and Google Cloud.",
    "{brand} employs machine learning algorithms for anomaly detection.",
    "{brand} supports SAML SSO and RBAC for enterprise identity management.",
    "{brand} offers both cloud-hosted and self-managed deployment options.",
    "{brand}'s architecture follows microservices patterns with container orchestration.",
    "{brand} provides comprehensive audit logging for compliance requirements.",
    "{brand} supports data residency requirements across 12 global regions.",
    "{brand} publishes monthly security advisories and maintains a responsible disclosure program.",
]

BRAND_NAMES = ['Brand_A', 'Brand_B', 'Competitor_C']
FEATURES = ['SOC2', 'HIPAA', 'PCI DSS', 'GDPR', 'FedRAMP', 'ISO 27001', 'zero-trust', 'API security', 'microservices', 'Kubernetes', 'machine learning', 'automation', 'analytics', 'real-time monitoring', 'encryption', 'SSO', 'SAML', 'RBAC']
CITATION_DOMAINS = ['reddit.com', 'gartner.com', 'g2.com', 'forrester.com', 'stackoverflow.com', 'techcrunch.com', 'capterra.com', 'linkedin.com', 'medium.com', 'github.com', 'wikipedia.org', 'crunchbase.com', 'bloomberg.com', 'zdnet.com', 'infoworld.com']
CITATION_TITLES = {
    'reddit.com': ['Security Discussion', 'Community Thread', 'Best Tools Thread', 'Enterprise Review', 'Migration Experience'],
    'gartner.com': ['Magic Quadrant Report', 'Market Guide', 'Peer Insights Review', 'Critical Capabilities'],
    'g2.com': ['Comparison Report', 'Enterprise Grid', 'User Reviews', 'Best Of Awards'],
    'forrester.com': ['Wave Report', 'Now Tech Analysis', 'TEI Study'],
    'stackoverflow.com': ['Best Practices Thread', 'Implementation Discussion', 'Architecture Review'],
    'techcrunch.com': ['Funding Announcement', 'Product Review', 'Market Analysis', 'Startup Profile'],
    'capterra.com': ['Comparison Report', 'User Reviews', 'Shortlist Report'],
    'linkedin.com': ['Industry Analysis', 'Expert Commentary', 'Market Trend'],
    'medium.com': ['Technical Deep Dive', 'Implementation Guide', 'Case Study'],
    'github.com': ['Open Source Project', 'Technical Documentation', 'API Reference'],
    'wikipedia.org': ['Company Overview', 'Technology Background', 'Industry Comparison'],
    'crunchbase.com': ['Company Profile', 'Funding History', 'Market Position'],
    'bloomberg.com': ['Market Analysis', 'Industry Report', 'Executive Interview'],
    'zdnet.com': ['Product Review', 'Enterprise Analysis', 'Technology Comparison'],
    'infoworld.com': ['Technical Review', 'Architecture Analysis', 'Benchmark Report'],
}


def load_uploaded_prompts():
    """Try to load uploaded prompts file for realistic prompt generation."""
    prompts_dir = UPLOAD_DIR / 'prompts'
    if not prompts_dir.exists():
        return None
    json_files = list(prompts_dir.glob('*.json'))
    if not json_files:
        return None
    try:
        with open(json_files[0], 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, list) and len(data) > 0:
            return data
    except Exception:
        pass
    return None


def load_uploaded_entities():
    """Try to load uploaded entity map for brand/feature extraction."""
    entities_dir = UPLOAD_DIR / 'entities'
    if not entities_dir.exists():
        return None
    json_files = list(entities_dir.glob('*.json'))
    if not json_files:
        return None
    try:
        with open(json_files[0], 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data
    except Exception:
        return None


def extract_brand_names_from_entities(entity_data):
    """Extract actual brand/product names from entity data."""
    brands = []
    if isinstance(entity_data, dict):
        for key in ['brands', 'products', 'companies', 'entities', 'competitors']:
            if key in entity_data and isinstance(entity_data[key], list):
                for item in entity_data[key]:
                    if isinstance(item, dict) and 'name' in item:
                        brands.append(item['name'])
                    elif isinstance(item, str):
                        brands.append(item)
        if not brands:
            for key, val in entity_data.items():
                if isinstance(val, dict) and 'name' in val:
                    brands.append(val['name'])
    if not brands:
        brands = BRAND_NAMES.copy()
    return brands[:6]


def generate_citations(count):
    """Generate realistic citation list."""
    citations = []
    for i in range(count):
        domain = random.choice(CITATION_DOMAINS)
        title = random.choice(CITATION_TITLES[domain])
        brand = random.choice(BRAND_NAMES)
        citations.append({
            "citation_index": i + 1,
            "url": f"https://www.{domain}/{brand.lower().replace('_', '-')}/{title.lower().replace(' ', '-')}",
            "title": f"{brand} {title}",
            "anchor_text": title,
            "type": "explicit",
            "source": "api_response",
            "confidence": round(random.uniform(0.7, 1.0), 2)
        })
    return citations


def generate_triples_from_text(text, brands):
    """Extract semantic triples from generated text."""
    triples = []
    for brand in brands:
        pattern_pos = rf'({re.escape(brand)})\s+(provides?|offers?|includes?|supports?|features?|leads?|excels?|delivers?)\s+(.+?)(?:\.|,)'
        pattern_neg = rf'({re.escape(brand)})\s+(lacks?|missing|doesn\'t have|requires?|has)\s+(.+?)(?:\.|,)'
        for match in re.finditer(pattern_pos, text, re.IGNORECASE):
            triples.append({"subject": match.group(1), "predicate": match.group(2), "object": match.group(3).strip()[:60], "sentiment": "positive"})
        for match in re.finditer(pattern_neg, text, re.IGNORECASE):
            obj = match.group(3).strip()[:60]
            sent = "negative" if any(w in obj.lower() for w in ['steep', 'lacks', 'missing', 'longer', 'prohibitive', 'complex', 'latency']) else "neutral"
            triples.append({"subject": match.group(1), "predicate": match.group(2), "object": obj, "sentiment": sent})
    return triples[:15]


def generate_response(brand, turn_type, brands):
    """Generate a single LLM-style response with realistic depth variation."""
    templates = random.choice([POSITIVE_TEMPLATES, POSITIVE_TEMPLATES, NEGATIVE_TEMPLATES, NEUTRAL_TEMPLATES])
    sentences = []
    for _ in range(random.randint(3, 7)):
        tmpl = random.choice(templates)
        feat = random.choice(FEATURES)
        feat2 = random.choice(FEATURES)
        sentences.append(tmpl.format(brand=brand, feature=feat, feature2=feat2))

    if turn_type == 'comparison_analysis':
        others = [b for b in brands if b != brand]
        if others:
            comp = random.choice(others)
            sentences.append(f"When comparing {brand} vs {comp}, {brand} has advantages in automation and compliance.")
            sentences.append(f"However, {comp} offers a more intuitive user interface and faster onboarding.")
            sentences.append(f"For enterprise deployments requiring {random.choice(FEATURES)}, {brand} is the recommended choice.")
    elif turn_type == 'pricing_procurement':
        price = random.randint(20, 80) * 1000
        sentences.append(f"{brand}'s enterprise plan starts at approximately ${price:,} annually.")
        sentences.append(f"The total cost of ownership depends on deployment size, with typical 3-year ROI of 280-420%.")
        sentences.append(f"Volume discounts are available for deployments exceeding 1000 seats.")
    elif turn_type == 'category_discovery':
        top = ', '.join(random.sample(brands, min(3, len(brands))))
        sentences.append(f"Top enterprise tools in the category include {top}.")
        sentences.append(f"Key evaluation criteria include {random.choice(FEATURES)}, scalability, and total cost of ownership.")
    elif turn_type == 'objection_compliance':
        sentences.append(f"Common concerns include implementation complexity and migration effort from legacy systems.")
        sentences.append(f"However, {brand} has addressed many of these through improved documentation and partner programs.")
    elif turn_type == 'feature_deep_dive':
        sentences.append(f"{brand}'s {random.choice(FEATURES)} implementation follows industry best practices.")
        sentences.append(f"Advanced configuration options allow customization for specific compliance requirements.")

    features = random.sample(FEATURES, random.randint(2, 4))
    for f in features:
        sentences.append(f"{brand} supports {f} with enterprise-grade implementation.")

    random.shuffle(sentences)
    return ' '.join(sentences)


def generate_sample_data():
    """Generate full sample dataset. Uses uploaded prompts when available."""
    uploaded_prompts = load_uploaded_prompts()
    uploaded_entities = load_uploaded_entities()
    brands = extract_brand_names_from_entities(uploaded_entities) if uploaded_entities else BRAND_NAMES.copy()
    random.shuffle(brands)

    results = []
    timestamp = datetime.now()

    if uploaded_prompts:
        sessions = uploaded_prompts[:min(len(uploaded_prompts), 800)]
        for session_idx, session in enumerate(sessions):
            session_id = session.get('id', str(uuid.uuid4()))
            persona = session.get('personaId', random.choice(PERSONAS))
            model = session.get('modelId', random.choice(MODELS))
            rag_enabled = session.get('ragEnabled', random.random() > 0.3)
            turns = session.get('turns', [])

            for turn in turns:
                turn_idx = turn.get('turnIndex', 0)
                turn_type = turn.get('turnType', TURN_TYPES[turn_idx % len(TURN_TYPES)])
                prompt = turn.get('prompt', f"What about {brands[0]}?")
                primary_brand = random.choice(brands)

                text = generate_response(primary_brand, turn_type, brands)
                citations = generate_citations(random.randint(2, 6) if rag_enabled else random.randint(0, 2))
                triples = generate_triples_from_text(text, brands)

                results.append({
                    "executionId": f"exec_{uuid.uuid4().hex[:8]}",
                    "promptSessionId": session_id,
                    "personaId": persona,
                    "modelId": model,
                    "turnIndex": turn_idx,
                    "turnType": turn_type,
                    "prompt": prompt,
                    "ragEnabled": rag_enabled,
                    "status": "fulfilled",
                    "result": {
                        "raw_text": text,
                        "citations": citations,
                        "entities": [{"name": b, "count": text.lower().count(b.lower())} for b in brands if b.lower() in text.lower()],
                        "triples": triples,
                        "sentiment": {"overall": random.choice(["positive", "neutral", "negative"])},
                        "usage": {"prompt_tokens": random.randint(100, 500), "completion_tokens": random.randint(200, 800)},
                        "citationCount": len(citations),
                        "search_performed": rag_enabled
                    },
                    "error": None,
                    "timestamp": (timestamp + timedelta(seconds=session_idx * 2)).isoformat()
                })
    else:
        session_count = 500
        for session_idx in range(session_count):
            session_id = str(uuid.uuid4())
            persona = random.choice(PERSONAS)
            primary_brand = random.choice(brands)
            rag_enabled = random.random() > 0.3
            num_turns = random.randint(3, 5)

            for turn_idx in range(num_turns):
                turn_type = TURN_TYPES[turn_idx % len(TURN_TYPES)]
                model = random.choice(MODELS)
                text = generate_response(primary_brand, turn_type, brands)
                citations = generate_citations(random.randint(2, 6) if rag_enabled else random.randint(0, 2))
                triples = generate_triples_from_text(text, brands)

                prompts_map = {
                    'category_discovery': f"What are the top enterprise tools for {random.choice(['financial services', 'healthcare', 'SaaS', 'government'])}?",
                    'feature_deep_dive': f"How does {brands[0]} handle {random.choice(FEATURES)}?",
                    'comparison_analysis': f"Compare {' vs '.join(brands[:3])} for enterprise deployment.",
                    'objection_compliance': f"Are there any known issues with {primary_brand}?",
                    'pricing_procurement': f"What is the total cost of ownership for {brands[0]}?"
                }

                results.append({
                    "executionId": f"exec_{uuid.uuid4().hex[:8]}",
                    "promptSessionId": session_id,
                    "personaId": persona,
                    "modelId": model,
                    "turnIndex": turn_idx,
                    "turnType": turn_type,
                    "prompt": prompts_map[turn_type],
                    "ragEnabled": rag_enabled,
                    "status": "fulfilled",
                    "result": {
                        "raw_text": text,
                        "citations": citations,
                        "entities": [{"name": b, "count": text.lower().count(b.lower())} for b in brands if b.lower() in text.lower()],
                        "triples": triples,
                        "sentiment": {"overall": random.choice(["positive", "neutral", "negative"])},
                        "usage": {"prompt_tokens": random.randint(100, 500), "completion_tokens": random.randint(200, 800)},
                        "citationCount": len(citations),
                        "search_performed": rag_enabled
                    },
                    "error": None,
                    "timestamp": (timestamp + timedelta(seconds=session_idx * 2)).isoformat()
                })

    return results


if __name__ == '__main__':
    print("Generating sample simulation data...")
    data = generate_sample_data()

    output_path = OUTPUT_DIR / 'all_results.json'
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"Generated {len(data)} records")
    print(f"Saved to: {output_path}")

    models = {}
    for r in data:
        m = r['modelId']
        models[m] = models.get(m, 0) + 1
    print(f"Models: {models}")
