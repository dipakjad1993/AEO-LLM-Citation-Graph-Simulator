"""
Prompt volumes weighting for SoMV (kills unweighted theater).
Joins data/uploads/prompts/prompt_volumes.json (scripts/prompt_miner.py)
against SoMV rows: volume-weighted SoMV per brand per surface.

Without volumes -> returns unweighted SoMV with weighted:false + spec
(never invents volumes).
"""
import json
import logging
from pathlib import Path
from typing import Dict, List, Any

logger = logging.getLogger(__name__)


class PromptVolumeWeighting:
    def __init__(self, config):
        self.config = config
        self.vol_path = Path("data/uploads/prompts/prompt_volumes.json")

    def load(self):
        if not self.vol_path.exists():
            return None
        try:
            return json.loads(self.vol_path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def analyze(self, rows: List[Dict]) -> Dict[str, Any]:
        vol = self.load()
        if not vol or vol.get("status") != "measured" or not vol.get("prompts"):
            return {"status": "no_data", "weighted": False,
                    "message": f"No prompt volumes at {self.vol_path}. Run: python scripts/prompt_miner.py --gsc gsc.csv. SoMV below is UNWEIGHTED (theater warning)."}
        vmap = {p["prompt"].strip().lower(): p for p in vol["prompts"]}
        weighted_hits = {}
        total_w = 0.0
        unmapped = 0
        for r in rows:
            q = str(r.get("prompt", "") or r.get("question", "")).strip().lower()
            v = vmap.get(q, {})
            w = float(v.get("volume_estimate", 0) or 0)
            if not w:
                unmapped += 1
                w = 1.0  # fall back to 1 with flag (never 0-out real rows)
            total_w += w
            for b in (r.get("brands_mentioned") or r.get("brands") or []):
                weighted_hits[str(b)] = weighted_hits.get(str(b), 0.0) + w
        sov_w = {b: round(h / total_w, 4) if total_w else 0 for b, h in weighted_hits.items()}
        return {"status": "ok", "weighted": True, "volume_sources": vol.get("sources", []),
                "volume_weighted_somv": dict(sorted(sov_w.items(), key=lambda kv: kv[1], reverse=True)),
                "total_weight": round(total_w, 1), "unmapped_prompts_fallback_w1": unmapped,
                "honesty": "estimated:true volumes. Unmapped prompts fall back to w=1 and are counted — see unmapped count."}
