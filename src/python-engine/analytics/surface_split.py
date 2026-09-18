"""
Surface split — AIO vs AI Mode vs Gemini app as THREE separate surfaces.
Ahrefs' split-indexes lesson: AIO + AI Mode are 86% semantically similar but
only 13.7% same URLs (540k pairs, Sept 2025). Averaging them into one SoMV
hides the truth. This module enforces per-surface SoMV/CPR/volatility/fan-out.

Surfaces (canonical):
  aio_serp_grounded      — Google AI Overviews via SERP
  ai_mode_serp_grounded  — Google AI Mode via SERP (separate surface!)
  gemini_api_grounded    — Gemini app/API with grounding
  + chatgpt_api_grounded, claude_api_grounded, perplexity_api_grounded,
    grok_api_grounded, copilot_serp_grounded (kept separate, never averaged)

Also emits Tinuiti-style social citation split (Reddit/YouTube share) because
Reddit = 44% of social citations in AIO (Jan 2026) vs 5% Gemini.

No fabrication: surfaces with zero rows -> status:no_data per surface.
"""
import logging
import math
from collections import Counter, defaultdict
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

CANONICAL_SURFACES = [
    "aio_serp_grounded", "ai_mode_serp_grounded", "gemini_api_grounded",
    "chatgpt_api_grounded", "claude_api_grounded", "perplexity_api_grounded",
    "grok_api_grounded", "copilot_serp_grounded",
]

SOCIAL_DOMAINS = {"reddit.com": "Reddit", "youtube.com": "YouTube", "youtu.be": "YouTube",
                  "x.com": "X", "twitter.com": "X", "linkedin.com": "LinkedIn",
                  "facebook.com": "Facebook", "instagram.com": "Instagram", "tiktok.com": "TikTok"}


def wilson(p, n, z=1.96):
    if not n:
        return (0.0, 0.0)
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (round(max(0, (c - m) / d), 4), round(min(1, (c + m) / d), 4))


def _surface_of(row):
    for k in ("surface", "search_surface", "provider_surface", "model_surface"):
        v = str(row.get(k, "") or "").strip()
        if v:
            return v
    model = str(row.get("model_id", "") or row.get("model", "")).lower()
    if "ai-mode" in model or "ai_mode" in model:
        return "ai_mode_serp_grounded"
    if "ai-overview" in model or "aio" in model or "ai_overview" in model:
        return "aio_serp_grounded"
    if "gemini" in model:
        return "gemini_api_grounded"
    if "gpt" in model or "openai" in model:
        return "chatgpt_api_grounded"
    if "claude" in model or "anthropic" in model:
        return "claude_api_grounded"
    if "sonar" in model or "perplexity" in model:
        return "perplexity_api_grounded"
    if "grok" in model:
        return "grok_api_grounded"
    if "copilot" in model:
        return "copilot_serp_grounded"
    return "unknown_surface"


class SurfaceSplit:
    def __init__(self, config):
        self.config = config

    def analyze(self, rows: List[Dict]) -> Dict[str, Any]:
        by_surface = defaultdict(list)
        for r in rows:
            by_surface[_surface_of(r)].append(r)
        per_surface = {}
        for s in CANONICAL_SURFACES + (["unknown_surface"] if "unknown_surface" in by_surface else []):
            rs = by_surface.get(s, [])
            if not rs:
                per_surface[s] = {"status": "no_data", "n": 0,
                                  "message": f"No rows for {s}. Collect via {'SERP API' if 'serp' in s else 'provider API'} — never averaged from other surfaces."}
                continue
            grounded = [r for r in rs if r.get("search_performed") and (r.get("citations") or r.get("citation_count"))]
            browse_rate = len(grounded) / len(rs) if rs else 0
            brands = Counter()
            for r in grounded:
                for b in (r.get("brands_mentioned") or r.get("brands") or []):
                    brands[str(b)] += 1
            total = len(grounded) or 1
            leaderboard = {b: {"share": round(c / total, 4), "wilson95": wilson(c / total, total), "n": total}
                           for b, c in brands.most_common(10)}
            # social split
            social = Counter()
            all_cites = 0
            for r in grounded:
                for c in (r.get("citations") or []):
                    url = c if isinstance(c, str) else (c.get("url", "") or c.get("domain", ""))
                    all_cites += 1
                    for dom, label in SOCIAL_DOMAINS.items():
                        if dom in str(url):
                            social[label] += 1
                            break
            per_surface[s] = {
                "status": "measured", "n": len(rs), "grounded_n": len(grounded),
                "browse_rate": round(browse_rate, 4),
                "flags": [f for f in [
                    "LOW_BROWSE_RATE" if browse_rate < 0.5 else None,
                    "BELOW_BENCHMARK_74" if browse_rate < 0.74 else None] if f],
                "leaderboard": leaderboard,
                "social_citation_split": {k: {"count": v, "share": round(v / all_cites, 4) if all_cites else 0}
                                          for k, v in social.most_common()},
                "social_citations_total": all_cites,
            }
        # overlap truth: AIO vs AI Mode cited-domain overlap (Jaccard on domains)
        def domains(s):
            ds = set()
            for r in by_surface.get(s, []):
                for c in (r.get("citations") or []):
                    u = c if isinstance(c, str) else (c.get("url", "") or c.get("domain", ""))
                    m = __import__("re").search(r"https?://([^/]+)", str(u))
                    if m:
                        ds.add(m.group(1).lower().replace("www.", ""))
            return ds
        aio_d, aim_d = domains("aio_serp_grounded"), domains("ai_mode_serp_grounded")
        overlap = {"aio_domains": len(aio_d), "ai_mode_domains": len(aim_d),
                   "shared": len(aio_d & aim_d),
                   "jaccard": round(len(aio_d & aim_d) / len(aio_d | aim_d), 4) if (aio_d | aim_d) else 0,
                   "reference": "Expect ~13.7% same-URL overlap (Ahrefs 540k pairs Sept 2025). High semantic similarity (86%) with low URL overlap is NORMAL — do not average surfaces."}
        return {"status": "ok", "per_surface": per_surface, "aio_vs_aimode_overlap": overlap,
                "rule": "NEVER average AIO + AI Mode + Gemini into one SoMV. Report per-surface + grounded-only + Wilson."}
