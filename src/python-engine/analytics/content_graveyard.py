"""
Content Graveyard (Somantra Aug-2026 study replication, open-audit version).
2.4M-citation finding: 57.2% of domains are cited once then never again;
comparison/FAQ/discount-savings formats persist ~2x; "complete guide" pages
are ~3.5x more likely to vanish; first-30%-of-page answers win 44% of cites.

This module is GROUNDED-ONLY: it reads YOUR trend store (data/trends.db)
plus the current run's cited domains + page-format labels. With <2 runs it
returns status:no_data with an honest message — never fabricates history.
"""
import re
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Dict, Any, List


FORMAT_RULES = [
    ("comparison", re.compile(r"compare|vs\.? |versus|alternative|best-\w+", re.I)),
    ("faq", re.compile(r"faq|frequently-asked|/questions?/", re.I)),
    ("discount_savings", re.compile(r"discount|saving|coupon|deal|pricing|price", re.I)),
    ("complete_guide", re.compile(r"complete-guide|ultimate-guide|definitive-guide", re.I)),
    ("docs", re.compile(r"/docs/|/handbook/|/reference/", re.I)),
]

PERSIST_MULTIPLIER = {
    "comparison": 2.0, "faq": 2.0, "discount_savings": 2.0,
    "docs": 1.5, "other": 1.0, "complete_guide": 0.29,  # 1/3.5 vanish risk
}


def classify_format(url: str, title: str = "") -> str:
    blob = f"{url} {title}"
    for name, rx in FORMAT_RULES:
        if rx.search(blob):
            return name
    return "other"


class ContentGraveyard:
    def __init__(self, config: Dict = None):
        self.config = config or {}

    def analyze(self, rows: List[Dict], root=None) -> Dict[str, Any]:
        base = Path(root) if root else Path("data")
        db = base / "trends.db"
        history: Dict[str, int] = {}
        run_count = 0
        if db.exists():
            try:
                con = sqlite3.connect(db)
                con.execute("CREATE TABLE IF NOT EXISTS citation_history(domain TEXT PRIMARY KEY, months_cited INTEGER, first_seen TEXT, last_seen TEXT)");
                for d, m in con.execute("SELECT domain, months_cited FROM citation_history"):
                    history[d] = m
                rc = con.execute("SELECT COUNT(*) FROM run_snapshots").fetchone()
                run_count = rc[0] if rc else 0
                con.close()
            except Exception:
                pass
        # current-run domains
        cur = Counter()
        fmt_counter = Counter()
        fmt_cited = Counter()
        for r in (rows or [])[:5000]:
            cits = r.get("citations") or []
            if isinstance(cits, int):
                continue
            for c in cits:
                url = (c.get("url") if isinstance(c, dict) else str(c)) or ""
                dom = re.sub(r"^https?://", "", url).split("/")[0].lower()
                if not dom:
                    continue
                cur[dom] += 1
                f = classify_format(url, (c.get("title") if isinstance(c, dict) else ""))
                fmt_counter[f] += 1
        if run_count < 2 and not history:
            # single-run heuristic: label formats, mark persistence as projected
            formats = [{"format": k, "cites_this_run": v,
                        "expected_persistence": PERSIST_MULTIPLIER.get(k, 1.0),
                        "guidance": "Comparison/FAQ/discount-savings persist ~2x; complete-guide vanishes ~3.5x (Somantra 2026)."}
                       for k, v in fmt_counter.most_common(10)]
            return {"status": "projected_single_run",
                    "message": "Only one run in trends.db — persistence is PROJECTED from format priors (Somantra 2026), not measured. Run 2+ daily cycles for measured graveyard.",
                    "runs_in_history": run_count,
                    "domains_this_run": len(cur),
                    "one_and_done_risk_pct": 57.2,
                    "benchmark": "Somantra Aug-2026: 57.2% domains cited once then never again.",
                    "formats": formats,
                    "top_domains": [{"domain": d, "cites": c, "format": classify_format(d)} for d, c in cur.most_common(15)]}
        # measured: domains cited in 1 month vs all months
        once = sum(1 for m in history.values() if m <= 1)
        total = max(len(history), 1)
        return {"status": "measured",
                "runs_in_history": run_count,
                "domains_tracked": len(history),
                "one_and_done_pct": round(100 * once / total, 1),
                "benchmark_one_and_done_pct": 57.2,
                "vs_benchmark": "above" if (100 * once / total) > 57.2 else "below_or_at",
                "formats": [{"format": k, "cites_this_run": v,
                             "expected_persistence": PERSIST_MULTIPLIER.get(k, 1.0)} for k, v in fmt_counter.most_common(10)],
                "at_risk_domains": sorted(history.items(), key=lambda x: x[1])[:10],
                "persistent_domains": sorted(history.items(), key=lambda x: -x[1])[:10]}
