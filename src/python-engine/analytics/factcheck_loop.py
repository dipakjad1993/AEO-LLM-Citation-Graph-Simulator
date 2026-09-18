"""
FactCheck + correction loop (Profound FactCheck + Noble/iPullRank pattern).
Pipeline today: verifies claims + live HTTP checks citations.
Table stakes 2026: identify -> correct -> republish loop with an
accuracy intervention rate metric (benchmark: 7.9% inaccurate claims).

This module:
  1. Scores brand claims (supported / stale / unsourced-stat / inaccurate)
  2. Emits correction patches (JSON-LD + dateModified + claim rewrites)
  3. Computes accuracy_intervention_rate = corrected / checked
  4. Writes remediation queue for scripts/remediation_pr.py --apply-factcheck

Never auto-publishes: patches are PR drafts (--apply opens a GitHub PR).
Without claims -> status:no_data + spec.
"""
import logging
import re
from datetime import datetime, timezone
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

BENCHMARK_INACCURATE = 0.079


class FactCheckLoop:
    def __init__(self, config):
        self.config = config

    def check_claim(self, claim: Dict) -> Dict:
        text = str(claim.get("text", "") or claim.get("sentence", ""))
        has_source = bool(claim.get("source_url") or claim.get("citation"))
        has_stat = bool(re.search(r"\d+(\.\d+)?\s*(%|percent|x\b|million|billion|\$)", text))
        stale = bool(re.search(r"20(1[0-9]|2[0-4])", text))  # year <= 2024 in 2026 = stale
        verdict = "supported"
        if has_stat and not has_source:
            verdict = "unsourced_stat"
        if stale:
            verdict = "stale"
        if claim.get("contradicted"):
            verdict = "inaccurate"
        return {"claim": text[:220], "verdict": verdict, "has_source": has_source,
                "has_stat": has_stat, "stale": stale}

    def patch_for(self, checked: Dict, page_url: str = "") -> Dict:
        v = checked["verdict"]
        if v == "supported":
            return {"action": "none"}
        if v == "unsourced_stat":
            return {"action": "add_source",
                    "patch": f"Attach primary source link + retrieval date to stat on {page_url or 'page'}: {checked['claim'][:120]}",
                    "jsonld_hint": "Add ClaimReview or citation in Article/FAQ answerText."}
        if v == "stale":
            return {"action": "refresh",
                    "patch": f"Replace stale year/stat with 2026 primary source + update dateModified on {page_url or 'page'}.",
                    "jsonld_hint": "Bump dateModified to today; keep datePublished."}
        return {"action": "correct",
                "patch": f"Rewrite inaccurate claim with sourced 2026 value on {page_url or 'page'}: {checked['claim'][:120]}",
                "jsonld_hint": "Correct JSON-LD + visible copy together (never JSON-LD-only fixes)."}

    def analyze(self, claims: List[Dict], page_url: str = "") -> Dict[str, Any]:
        if not claims:
            return {"status": "no_data",
                    "message": "No claims. Provide triples/sentences with {text, source_url?, contradicted?} — see triple_extractor output."}
        checked = [self.check_claim(c) for c in claims]
        patches = [self.patch_for(c, page_url) for c in checked]
        needs_fix = sum(1 for p in patches if p.get("action") != "none")
        rate = round(needs_fix / len(checked), 4) if checked else 0
        return {
            "status": "ok", "checked": len(checked), "needs_fix": needs_fix,
            "accuracy_intervention_rate": rate,
            "benchmark_inaccurate": BENCHMARK_INACCURATE,
            "vs_benchmark": "above" if rate > BENCHMARK_INACCURATE else "at_or_below",
            "verdicts": checked[:50],
            "patches": [p for p in patches if p.get("action") != "none"][:50],
            "remediation_mode": "Drafts only — apply via: python scripts/remediation_pr.py --apply-factcheck (opens GitHub PR, never auto-publishes).",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
