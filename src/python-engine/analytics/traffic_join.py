"""
GSC + GA4 traffic join — generative-inclusion gate + referrer revenue proof.

Without a traffic join you cannot prove revenue: SoMV says "we are mentioned",
traffic says "it sent visits that converted". This module ingests:

  1. Google Search Console export (CSV/JSON in data/uploads/traffic/):
     query, clicks, impressions, position + (optional) ai_overview_present flag.
     Computes the GENERATIVE-INCLUSION GATE: share of your converting queries
     where an AI Overview / AI Mode answer was present.
  2. GA4 / analytics export (CSV/JSON): session source/medium, e.g.
     utm_source=chatgpt.com / perplexity.ai / copilot referrers, conversions,
     revenue. Joins AI-referrer sessions to conversions.

Both inputs are optional. With neither, the module returns status=no_data with
an exact schema spec — never invented numbers.
"""

import csv
import json
import logging
import re
from pathlib import Path
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

AI_REFERRERS = ("chatgpt.com", "openai.com", "perplexity.ai", "claude.ai",
                "anthropic.com", "copilot.microsoft.com", "bing.com/chat",
                "gemini.google.com", "bard.google.com", "grok.x.ai",
                "you.com", "phind.com")

EXPECTED_GSC_FIELDS = {"query", "clicks", "impressions"}
EXPECTED_GA_FIELDS = {"source", "sessions"}


def _read_table(path: Path) -> List[Dict[str, str]]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
        if isinstance(data, dict):
            for key in ("rows", "data", "items"):
                if isinstance(data.get(key), list):
                    return data[key]
        return data if isinstance(data, list) else []
    return list(csv.DictReader(text.splitlines()))


def _f(x, default=0.0) -> float:
    try:
        return float(str(x).replace(",", "").strip() or default)
    except Exception:
        return default


class TrafficJoin:
    def __init__(self, config: Dict):
        self.config = config
        self.traffic_dir = Path("data/uploads/traffic")

    def _find(self, *names) -> List[Path]:
        if not self.traffic_dir.exists():
            return []
        out = []
        for f in sorted(self.traffic_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in (".csv", ".json"):
                if not names or any(n in f.name.lower() for n in names):
                    out.append(f)
        return out

    def gsc_gate(self) -> Dict[str, Any]:
        files = self._find("gsc", "search", "console")
        if not files:
            return {"status": "no_data",
                    "message": f"No GSC export in {self.traffic_dir}/. Expected columns: query, clicks, impressions, position, ai_overview_present(0/1)."}
        rows = _read_table(files[0])
        total_clicks = sum(_f(r.get("clicks")) for r in rows)
        aio_clicks = sum(_f(r.get("clicks")) for r in rows if str(r.get("ai_overview_present", "")).strip() in ("1", "true", "yes"))
        conv_queries = [r for r in rows if _f(r.get("clicks")) > 0]
        return {
            "status": "measured", "file": files[0].name,
            "queries": len(rows), "converting_queries": len(conv_queries),
            "total_clicks": total_clicks,
            "clicks_on_aio_queries": aio_clicks,
            "generative_inclusion_rate": round(aio_clicks / total_clicks, 4) if total_clicks else 0,
            "evidence": "GSC export join (ai_overview_present flag per query)",
        }

    def ga4_referrers(self) -> Dict[str, Any]:
        files = self._find("ga4", "analytics", "referrer", "traffic")
        files = [f for f in files if "gsc" not in f.name.lower() and "console" not in f.name.lower()] or self._find()
        if not files:
            return {"status": "no_data",
                    "message": f"No GA4 export in {self.traffic_dir}/. Expected columns: source, sessions, conversions, revenue. Tag links with utm_source=chatgpt.com etc."}
        rows = _read_table(files[0])
        ai_sessions, ai_conv, ai_rev = 0.0, 0.0, 0.0
        tot_sessions, tot_conv, tot_rev = 0.0, 0.0, 0.0
        per_source = {}
        for r in rows:
            src = str(r.get("source", "")).lower()
            s, c, rev = _f(r.get("sessions")), _f(r.get("conversions")), _f(r.get("revenue"))
            tot_sessions += s
            tot_conv += c
            tot_rev += rev
            is_ai = any(a in src for a in AI_REFERRERS)
            per_source[src or "(direct)"] = {"sessions": s, "conversions": c, "revenue": rev, "ai_referrer": is_ai}
            if is_ai:
                ai_sessions += s
                ai_conv += c
                ai_rev += rev
        return {
            "status": "measured", "file": files[0].name,
            "total_sessions": tot_sessions, "ai_sessions": ai_sessions,
            "ai_session_share": round(ai_sessions / tot_sessions, 4) if tot_sessions else 0,
            "ai_conversions": ai_conv, "ai_revenue": ai_rev,
            "total_revenue": tot_rev,
            "ai_revenue_share": round(ai_rev / tot_rev, 4) if tot_rev else 0,
            "per_source": dict(sorted(per_source.items(), key=lambda kv: kv[1]["sessions"], reverse=True)[:25]),
            "evidence": "GA4 referrer join on AI domains (chatgpt.com, perplexity.ai, claude.ai, copilot, gemini)",
        }

    def analyze(self) -> Dict[str, Any]:
        return {"gsc_generative_gate": self.gsc_gate(), "ga4_ai_referrers": self.ga4_referrers(), "status": "ok"}

    def save(self, results: Dict, output_dir) -> None:
        reports = output_dir / "reports"
        reports.mkdir(exist_ok=True)
        with open(reports / "traffic_join.json", "w") as f:
            json.dump(results, f, indent=2, default=str)
        logger.info("Saved traffic join to %s", reports)
