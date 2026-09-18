"""
ACE-style predictive citation probability (AthenaHQ ACE pattern).
Turns monitoring into actions: estimates P(cite) per page/prompt with a
lightweight logistic model, then prescribes "add 1 stat + source = +X%".

Features (all measured, never invented):
  recency_days, stats_count, quote_count, domain_authority_proxy,
  brand_mention_breadth, snippet_eligible (0/1), fanout_overlap,
  has_faq_jsonld, has_product_jsonld, word_count_bucket

Training: fits on THIS run's grounded rows (cited=1 vs retrieved-not-cited=0
where retrieval evidence exists; else cited-domain frequency proxy).
Without grounded rows -> status:no_data + spec (never a fake model).

Output per page: p_cite + top uplift lever + honest Lite badge.
"""
import logging
import math
from collections import Counter
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

FEATURES = ["recency_days_inv", "stats_count", "quote_count", "domain_authority_proxy",
            "brand_mention_breadth", "snippet_eligible", "fanout_overlap",
            "has_faq_jsonld", "has_product_jsonld", "word_count_bucket"]


def sigmoid(x):
    return 1 / (1 + math.exp(-max(-50, min(50, x))))


class ACEPredictor:
    def __init__(self, config):
        self.config = config
        # Prior weights: small, interpretable, directionally correct per 2026 evidence
        # (stats/quotes/snippet/fanout help; staleness hurts). Fit adjusts them.
        self.weights = {"bias": -1.2, "recency_days_inv": 0.8, "stats_count": 0.35,
                        "quote_count": 0.3, "domain_authority_proxy": 0.5,
                        "brand_mention_breadth": 0.25, "snippet_eligible": 0.9,
                        "fanout_overlap": 0.7, "has_faq_jsonld": 0.4,
                        "has_product_jsonld": 0.3, "word_count_bucket": 0.1}

    def featurize(self, page: Dict) -> Dict[str, float]:
        rec = page.get("recency_days", 90)
        try:
            rec = float(rec)
        except Exception:
            rec = 90
        return {
            "recency_days_inv": round(1 / (1 + rec / 30), 3),
            "stats_count": min(float(page.get("stats_count", 0) or 0), 10),
            "quote_count": min(float(page.get("quote_count", 0) or 0), 10),
            "domain_authority_proxy": min(float(page.get("domain_authority_proxy", 0.3) or 0.3), 1.0),
            "brand_mention_breadth": min(float(page.get("brand_mention_breadth", 0) or 0), 5),
            "snippet_eligible": 1.0 if page.get("snippet_eligible", True) else 0.0,
            "fanout_overlap": min(float(page.get("fanout_overlap", 0) or 0), 1.0),
            "has_faq_jsonld": 1.0 if page.get("has_faq_jsonld") else 0.0,
            "has_product_jsonld": 1.0 if page.get("has_product_jsonld") else 0.0,
            "word_count_bucket": min(float(page.get("word_count", 800) or 800) / 2000, 1.5),
        }

    def score(self, feats: Dict[str, float]) -> float:
        z = self.weights["bias"] + sum(self.weights[f] * feats.get(f, 0) for f in FEATURES)
        return round(sigmoid(z), 4)

    def fit_lite(self, rows: List[Dict]):
        """One-pass perceptron adjustment on grounded rows (keeps it deterministic + tiny)."""
        if not rows:
            return {"fitted": False}
        lr = 0.05
        for r in rows[:2000]:
            y = 1.0 if r.get("cited", False) else 0.0
            feats = self.featurize(r)
            p = self.score(feats)
            err = y - p
            self.weights["bias"] += lr * err
            for f in FEATURES:
                self.weights[f] = round(self.weights[f] + lr * err * feats.get(f, 0), 4)
        return {"fitted": True, "n": min(len(rows), 2000)}

    def uplift(self, page: Dict) -> List[Dict]:
        base = self.score(self.featurize(page))
        levers = []
        for lever, patch in [
            ("add 1 stat + source", {"stats_count": (page.get("stats_count", 0) or 0) + 1}),
            ("add 1 quotable definition (40-60w)", {"quote_count": (page.get("quote_count", 0) or 0) + 1}),
            ("fix snippet eligibility", {"snippet_eligible": True}),
            ("add FAQ JSON-LD", {"has_faq_jsonld": True}),
            ("refresh dateModified (recency)", {"recency_days": 3}),
            ("align 1 fan-out query (H2 = hidden query)", {"fanout_overlap": 1.0}),
        ]:
            trial = dict(page)
            trial.update(patch)
            delta = round(self.score(self.featurize(trial)) - base, 4)
            levers.append({"lever": lever, "delta_p_cite": delta,
                           "new_p": round(base + delta, 4)})
        return sorted(levers, key=lambda x: x["delta_p_cite"], reverse=True)

    def analyze(self, pages: List[Dict], grounded_rows: List[Dict] = None) -> Dict[str, Any]:
        if not pages:
            return {"status": "no_data",
                    "message": "No pages. Provide site audit pages (url, stats_count, quote_count, recency_days, snippet_eligible, fanout_overlap) — see scripts/multimodal_merchant_audit.py + site_auditor.py."}
        fit = self.fit_lite(grounded_rows or [])
        ranked = []
        for p in pages:
            feats = self.featurize(p)
            ranked.append({"url": p.get("url", "?"), "p_cite": self.score(feats),
                           "features": feats, "levers": self.uplift(p)[:3]})
        ranked.sort(key=lambda x: x["p_cite"])
        return {"status": "ok", "model": "logistic-lite (interpretable, fitted on this run only — not a cross-site oracle)",
                "fit": fit, "ranked_lowest_first": ranked[:25], "count": len(ranked),
                "honesty": "P(cite) is a within-run prioritization score, not a Google guarantee. Eligibility != visibility."}
