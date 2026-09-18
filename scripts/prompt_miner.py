"""
Prompt volumes + real question mining (Conversation Explorer-lite).
Profound's #1 moat is demand: without volumes, SoMV is unweighted theater.

Mines candidate prompts from:
  1. People Also Ask (SERP API, optional) — real phrasing buyers type
  2. GSC queries export (CSV) — what already drives impressions
  3. Search Console GenAI queries (gsc_genai_normalized.csv)
  4. Site search logs (CSV: query/sessions)
  5. Sales call transcripts (TXT dir — question sentences extracted)

Emits:
  - prompt_volumes.json: {prompt, volume_estimate, sources[], funnel_stage, verb_type, priority}
  - conversation_clusters.json: clustered real phrasing (keyword-lite, no torch required)
Verb-based types preserved: category_discovery, feature_deep_dive, comparison,
objection_compliance, pricing_procurement.

Never fabricates volumes: without any source -> status:no_data + spec.
Volume estimates are labelled estimated:true with method (no fake precision).
"""
import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

VERB_TYPES = ["category_discovery", "feature_deep_dive", "comparison_analysis",
              "objection_compliance", "pricing_procurement"]


def classify_verb(q):
    ql = q.lower()
    if any(w in ql for w in ["vs", "versus", "compare", "comparison", "alternative", "better than"]):
        return "comparison_analysis"
    if any(w in ql for w in ["price", "pricing", "cost", "quote", "procurement", "buy", "purchase", "plan"]):
        return "pricing_procurement"
    if any(w in ql for w in ["secure", "compliance", "soc2", "gdpr", "hipaa", "risk", "objection", "limit", "downside"]):
        return "objection_compliance"
    if any(w in ql for w in ["feature", "how does", "integration", "api", "spec", "deep"]):
        return "feature_deep_dive"
    return "category_discovery"


def funnel_stage(verb):
    return {"category_discovery": "awareness", "feature_deep_dive": "consideration",
            "comparison_analysis": "consideration", "objection_compliance": "decision",
            "pricing_procurement": "decision"}[verb]


def load_gsc_queries(path):
    out = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        m = {(fn or "").strip().lower().replace(" ", "_"): fn for fn in (r.fieldnames or [])}
        for row in r:
            q = (row.get(m.get("query", ""), "") or "").strip()
            if not q:
                continue
            impr = row.get(m.get("impressions", ""), 0) or 0
            try:
                impr = float(str(impr).replace(",", "") or 0)
            except Exception:
                impr = 0
            out.append({"prompt": q, "volume_estimate": impr, "sources": ["gsc"]})
    return out


def load_site_search(path):
    out = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        m = {(fn or "").strip().lower().replace(" ", "_"): fn for fn in (r.fieldnames or [])}
        qk = m.get("query") or m.get("search_term") or m.get("term")
        sk = m.get("sessions") or m.get("searches") or m.get("count")
        if not qk:
            raise ValueError(f"Site search {path}: need query column. Got: {r.fieldnames}")
        for row in r:
            q = (row.get(qk, "") or "").strip()
            if q:
                try:
                    v = float(str(row.get(sk, 0) if sk else 0).replace(",", "") or 0)
                except Exception:
                    v = 0
                out.append({"prompt": q, "volume_estimate": v, "sources": ["site_search"]})
    return out


def load_transcripts(txt_dir):
    out = []
    for fp in Path(txt_dir).glob("*.txt"):
        text = fp.read_text(encoding="utf-8", errors="ignore")
        for sent in re.split(r"(?<=[?])\s+", text):
            s = sent.strip()
            if len(s) > 20 and "?" in s and len(s) < 300:
                out.append({"prompt": s[:280], "volume_estimate": 1, "sources": [f"sales_call:{fp.name}"]})
    return out


def cluster_lite(prompts):
    """Keyword-lite clustering (no torch): token-overlap greedy clustering."""
    stop = {"what", "is", "the", "best", "for", "and", "are", "how", "does", "with", "our", "your", "a", "an", "to", "of"}
    clusters = []
    for p in prompts:
        toks = set(re.findall(r"[a-z0-9]+", p["prompt"].lower())) - stop
        placed = False
        for c in clusters:
            if len(toks & c["tokens"]) >= 2:
                c["members"].append(p)
                c["tokens"] |= toks
                placed = True
                break
        if not placed:
            clusters.append({"label": " ".join(sorted(toks)[:5]) or p["prompt"][:40],
                             "tokens": set(toks), "members": [p]})
    result = []
    for c in clusters:
        members = c["members"]
        vol = sum(m.get("volume_estimate", 0) for m in members)
        result.append({"label": c["label"], "size": len(members),
                       "volume_estimate": vol, "estimated": True,
                       "examples": [m["prompt"] for m in members[:5]]})
    return sorted(result, key=lambda x: x["volume_estimate"], reverse=True)


def main():
    ap = argparse.ArgumentParser(description="Prompt volumes + question mining")
    ap.add_argument("--gsc", default=None)
    ap.add_argument("--genai", default=None)
    ap.add_argument("--site-search", default=None)
    ap.add_argument("--transcripts", default=None)
    ap.add_argument("--paa", default=None, help="PAA JSON/CSV export (query column)")
    ap.add_argument("--brand", default="")
    ap.add_argument("--out", default=str(ROOT / "data" / "uploads" / "prompts"))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    mined = []
    sources_used = []
    if a.gsc and Path(a.gsc).exists():
        mined += load_gsc_queries(a.gsc)
        sources_used.append("gsc")
    if a.genai and Path(a.genai).exists():
        mined += load_gsc_queries(a.genai)
        sources_used.append("genai")
    if a.site_search and Path(a.site_search).exists():
        mined += load_site_search(a.site_search)
        sources_used.append("site_search")
    if a.transcripts and Path(a.transcripts).exists():
        mined += load_transcripts(a.transcripts)
        sources_used.append("sales_calls")
    if a.paa and Path(a.paa).exists():
        try:
            with open(a.paa, newline="", encoding="utf-8-sig") as f:
                r = csv.DictReader(f)
                m = {(fn or "").strip().lower(): fn for fn in (r.fieldnames or [])}
                qk = m.get("query") or m.get("question") or list(m.values())[0]
                for row in r:
                    q = (row.get(qk, "") or "").strip()
                    if q:
                        mined.append({"prompt": q, "volume_estimate": 5, "sources": ["paa"]})
            sources_used.append("paa")
        except Exception as e:
            print(f"PAA load failed: {e}", file=sys.stderr)
    if not mined:
        spec = {"status": "no_data",
                "message": "No mining source. Pass --gsc GSC export, --site-search CSV, --transcripts DIR, or --paa CSV.",
                "expected": {"gsc": "query,clicks,impressions", "site_search": "query,sessions",
                             "transcripts": "TXT dir with ? sentences", "paa": "query column"}}
        print(json.dumps(spec, indent=2))
        (out / "prompt_volumes.json").write_text(json.dumps(spec, indent=2))
        return 2
    # merge duplicates
    merged = {}
    for m in mined:
        k = m["prompt"].strip().lower()
        if k not in merged:
            merged[k] = {"prompt": m["prompt"].strip(), "volume_estimate": 0, "sources": []}
        merged[k]["volume_estimate"] += m.get("volume_estimate", 0) or 0
        for s in m.get("sources", []):
            if s not in merged[k]["sources"]:
                merged[k]["sources"].append(s)
    items = list(merged.values())
    for it in items:
        it["verb_type"] = classify_verb(it["prompt"])
        it["funnel_stage"] = funnel_stage(it["verb_type"])
        it["estimated"] = True
        it["method"] = "sum of source impressions/sessions; PAA/transcript rows count as 5/1 placeholder — label estimated, never precise"
    items.sort(key=lambda x: x["volume_estimate"], reverse=True)
    # priority: high volume + decision stage first
    for i, it in enumerate(items):
        boost = 1.5 if it["funnel_stage"] == "decision" else 1.0
        it["priority_score"] = round(it["volume_estimate"] * boost, 1)
    items.sort(key=lambda x: x["priority_score"], reverse=True)
    clusters = cluster_lite(items[:200])
    final = {"status": "measured", "sources": sources_used, "prompts": items[:300],
             "clusters": clusters[:30], "count": len(items),
             "note": "Volumes are estimated:true (source impressions/sessions). Use priority_score to weight SoMV — unweighted SoMV is theater."}
    if a.brand:
        final["brand"] = a.brand
    with open(out / "prompt_volumes.json", "w") as f:
        json.dump(final, f, indent=2)
    with open(out / "conversation_clusters.json", "w") as f:
        json.dump({"status": "measured", "clusters": clusters[:30]}, f, indent=2, default=str)
    print(f"Mined {len(items)} prompts from {sources_used} -> {out / 'prompt_volumes.json'}")
    print(json.dumps({"top5": items[:5], "clusters": len(clusters)}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
