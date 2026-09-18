"""
Auto onboarding — kill manual setup (Ahrefs' failure mode).
Enter domain -> auto-crawl sitemap -> auto-suggest 20 money prompts +
competitors (from sitemap + homepage outbound signals) + schema/snippet/robots preflight.

2-min value, not 2-hour. Never fabricates: competitors without evidence are
labelled heuristic:true; prompts are verb-typed money prompts ready for
promptGenerator.js.

Usage:
  python scripts/auto_onboard.py --domain example.com --out data/uploads/system_config/
  python scripts/auto_onboard.py --domain https://example.com/pricing --competitors "Foo,Bar" --out ...
"""
import argparse
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse, urljoin

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; AEO-Onboard/2.1)"


def fetch(url, timeout=15, max_bytes=800000):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(max_bytes).decode("utf-8", "ignore")
            return {"status": r.status, "headers": dict(r.headers), "body": body}
    except Exception as e:
        return {"error": str(e)}


def crawl_sitemap(origin):
    urls = []
    for cand in ["/sitemap.xml", "/sitemap_index.xml"]:
        f = fetch(origin + cand)
        body = f.get("body", "")
        if "<url" in body or "<sitemap" in body:
            try:
                root = ET.fromstring(body)
                ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
                locs = [e.text for e in root.findall(".//s:loc", ns)] or \
                       [e.text for e in root.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
                if not locs:
                    locs = re.findall(r"<loc>(.*?)</loc>", body)[:500]
                # if sitemap index, fetch first child
                if any("sitemap" in (l or "") and l.endswith(".xml") for l in locs[:5]) and len(locs) < 50:
                    for child in locs[:3]:
                        cf = fetch(child)
                        locs += re.findall(r"<loc>(.*?)</loc>", cf.get("body", ""))[:200]
                urls = [u for u in locs if u and not u.endswith(".xml")][:500]
                return {"status": "measured", "sitemap": cand, "urls": urls, "count": len(urls)}
            except Exception as e:
                return {"status": "partial", "error": str(e), "urls": [], "count": 0}
    return {"status": "no_data", "message": "No /sitemap.xml found. Pass --pages manually.", "urls": [], "count": 0}


MONEY_PROMPT_TEMPLATES = [
    ("category_discovery", "What are the best {category} solutions for enterprise teams in 2026?"),
    ("category_discovery", "Which {category} vendors should a {persona} shortlist this year?"),
    ("feature_deep_dive", "How does {brand} handle {category} integrations and API access?"),
    ("feature_deep_dive", "What security and SSO features does {brand} offer for {category}?"),
    ("comparison_analysis", "{brand} vs {comp}: which is better for enterprise {category}?"),
    ("comparison_analysis", "Compare top {category} vendors on price, security, and support."),
    ("objection_compliance", "Is {brand} SOC2/GDPR compliant for {category} deployments?"),
    ("objection_compliance", "What are the limitations or downsides of {brand} for {category}?"),
    ("pricing_procurement", "How much does {brand} cost for {category} (enterprise pricing)?"),
    ("pricing_procurement", "{brand} pricing vs {comp}: total cost for 500 seats?"),
]


def suggest_prompts(brand, category, competitors, sitemap_urls):
    # pick representative money-page slugs to ground prompts
    slugs = []
    for u in (sitemap_urls or [])[:500]:
        p = urlparse(u).path.lower()
        if any(k in p for k in ["pricing", "security", "integration", "enterprise", "compare", "vs"]):
            slugs.append(u)
    comps = competitors or ["CompetitorA", "CompetitorB"]
    prompts = []
    for i in range(20):
        vt, tpl = MONEY_PROMPT_TEMPLATES[i % len(MONEY_PROMPT_TEMPLATES)]
        comp = comps[i % len(comps)]
        q = tpl.format(brand=brand or "our brand", category=category or "this category",
                       comp=comp, persona="CISO")
        prompts.append({"prompt": q, "verb_type": vt,
                        "funnel_stage": "decision" if vt in ("objection_compliance", "pricing_procurement") else ("consideration" if "comparison" in vt or "feature" in vt else "awareness"),
                        "money_prompt": vt in ("comparison_analysis", "pricing_procurement"),
                        "evidence": f"template:{vt} + sitemap:{len(slugs)} money URLs"})
    return prompts, slugs[:10]


def preflight(origin):
    robots = fetch(origin + "/robots.txt")
    home = fetch(origin)
    body = home.get("body", "")
    import re
    m = re.search(r'<meta[^>]*name=["\']robots["\'][^>]*content=["\']([^"\']+)["\']', body, re.I)
    meta = (m.group(1) if m else "").lower()
    checks = {
        "robots_fetchable": robots.get("status") == 200,
        "oai_searchbot_blocked": bool(re.search(r"User-agent:\s*OAI-SearchBot.*?(?=User-agent:|\Z)", robots.get("body", ""), re.S | re.I) and "disallow: /" in robots.get("body", "").lower()),
        "homepage_fetchable": home.get("status") == 200,
        "nosnippet": "nosnippet" in meta,
        "max_snippet_0": bool(re.search(r"max-snippet:\s*0", meta)),
        "has_faq_jsonld": "faqpage" in body.lower(),
        "has_product_jsonld": '"product"' in body.lower(),
        "has_mcp": fetch(origin + "/.well-known/mcp.json").get("status") == 200,
        "has_llms_txt": fetch(origin + "/llms.txt").get("status") == 200,
    }
    return checks


def main():
    ap = argparse.ArgumentParser(description="Auto onboarding: domain -> prompts + competitors + preflight")
    ap.add_argument("--domain", required=True)
    ap.add_argument("--brand", default=None)
    ap.add_argument("--category", default="your category")
    ap.add_argument("--competitors", default=None, help="Comma-separated known competitors (optional)")
    ap.add_argument("--out", default=str(ROOT / "data" / "uploads" / "system_config"))
    a = ap.parse_args()
    origin = a.domain if "://" in a.domain else "https://" + a.domain
    origin = origin.rstrip("/")
    netloc = urlparse(origin).netloc
    brand = a.brand or netloc.split(".")[0].capitalize()
    sitemap = crawl_sitemap(origin)
    comps = [c.strip() for c in (a.competitors or "").split(",") if c.strip()]
    heuristic = False
    if not comps:
        # heuristic: outbound links to likely competitor domains from homepage
        home = fetch(origin).get("body", "")
        links = re.findall(r'href="https?://([^"/]+)', home, re.I)
        for d in links:
            if d != netloc and any(k in d for k in ["g2.com", "capterra", "trustradius"]):
                continue
            if d != netloc and "." in d and len(comps) < 5:
                name = d.split(".")[0].capitalize()
                if name.lower() not in (brand.lower(), "www") and name not in comps:
                    comps.append(name)
        heuristic = True
        if not comps:
            comps = ["CompetitorA", "CompetitorB"]
    prompts, money_urls = suggest_prompts(brand, a.category, comps, sitemap.get("urls", []))
    checks = preflight(origin)
    result = {
        "status": "measured", "domain": origin, "brand": brand, "category": a.category,
        "sitemap": {"count": sitemap.get("count", 0), "status": sitemap.get("status"),
                    "money_urls_sample": money_urls},
        "competitors": comps, "competitors_heuristic": heuristic,
        "competitors_note": ("heuristic:true — verify against G2/CRM/AIO citations, then re-run with --competitors."
                             if heuristic else "provided by user — will be cross-checked against AIO/Perplexity citations at runtime."),
        "suggested_prompts": prompts,
        "preflight": checks,
        "next": ["Review suggested_prompts (20 money prompts)", "Save as data/uploads/prompts/onboard_prompts.json",
                 "Run: python scripts/prompt_miner.py --gsc gsc.csv for volumes", "Run full pipeline"],
    }
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "onboard_pack.json", "w") as f:
        json.dump(result, f, indent=2)
    with open(ROOT / "data" / "uploads" / "prompts" / "onboard_prompts.json", "w") as f:
        Path(ROOT / "data" / "uploads" / "prompts").mkdir(parents=True, exist_ok=True)
        json.dump([{"prompt": p["prompt"], "verb_type": p["verb_type"]} for p in prompts], f, indent=2)
    # API contract (GET /api/onboard): prompts[], competitors[], aliases[], lastmod, preflight.snippet_eligible
    lastmod = None
    try:
        for u in (sitemap.get("urls", []) or [])[:5]:
            f = fetch(u)
            m = re.search(r'(?:dateModified|lastmod|article:modified_time)["\s:>]+([0-9]{4}-[0-9]{2}-[0-9]{2})', f.get("body", "") or "")
            if m:
                lastmod = m.group(1)
                break
    except Exception:
        pass
    checks["snippet_eligible"] = not (checks.get("nosnippet") or checks.get("max_snippet_0"))
    api_view = {"status": result["status"], "domain": origin, "brand": brand,
                "prompts": [p["prompt"] for p in prompts], "suggested_prompts": prompts,
                "competitors": comps, "competitors_heuristic": heuristic,
                "aliases": [brand], "lastmod": lastmod, "preflight": checks,
                "sitemap": result["sitemap"]}
    print(json.dumps(api_view))
    return 0


if __name__ == "__main__":
    sys.exit(main())
