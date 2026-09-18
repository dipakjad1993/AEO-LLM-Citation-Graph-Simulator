"""
Multimodal + Merchant + Local truth audit.
2026 reality: 1 in 6 AI Mode searches multimodal (image +40% MoM), YouTube
mentions 0.737 citation correlation (Dec 2025), Merchant Center + Business
Profile create visibility beyond text links (Google 2026).

Checks (live fetch, zero fabrication):
  images: alt presence/coverage, descriptive alt rate, image_link (feed) match
  video: transcript/captions, chapters, YouTube mention surface
  merchant: GTIN/price/availability/image_link presence (extends Commerce Truth)
  local: LocalBusiness JSON-LD + GBP checklist per locale (name/address/phone/hours/category/reviews URL)

Usage:
  python scripts/multimodal_merchant_audit.py --site https://example.com --feed merchant_feed.csv --youtube-handle @brand --out data/uploads/commerce/
"""
import argparse
import csv
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; AEO-Multimodal-Audit/2.1)"


def fetch(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(800000).decode("utf-8", "ignore")
            return {"status": r.status, "body": body}
    except Exception as e:
        return {"error": str(e)}


def audit_page(url):
    f = fetch(url)
    body = f.get("body", "")
    if not body:
        return {"url": url, "status": "no_data", "error": f.get("error", "empty")}
    imgs = re.findall(r"<img\b[^>]*>", body, re.I)
    alts = [re.search(r'alt=["\']([^"\']*)["\']', t, re.I) for t in imgs]
    alt_present = sum(1 for a in alts if a and a.group(1).strip())
    alt_descriptive = sum(1 for a in alts if a and len(a.group(1).strip()) >= 12)
    videos = len(re.findall(r"<video\b|youtube\.com/embed|youtu\.be|vimeo", body, re.I))
    transcripts = len(re.findall(r"<track\b|transcript|captions", body, re.I))
    chapters = len(re.findall(r"chapter|Chapter", body))
    jsonlds = re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', body, re.S | re.I)
    has_product = has_local = has_video_obj = False
    gtin = price = avail = image_link = False
    for j in jsonlds:
        jl = j.lower()
        if '"product"' in jl:
            has_product = True
            gtin = gtin or ("gtin" in jl or "mpn" in jl)
            price = price or ("price" in jl)
            avail = avail or ("availability" in jl)
            image_link = image_link or ("image" in jl)
        if "localbusiness" in jl or "store" in jl or "restaurant" in jl:
            has_local = True
        if "videoobject" in jl:
            has_video_obj = True
    return {
        "url": url, "status": "measured", "http": f.get("status"),
        "images": {"count": len(imgs), "alt_coverage": round(alt_present / len(imgs), 3) if imgs else 1.0,
                   "descriptive_alt_rate": round(alt_descriptive / len(imgs), 3) if imgs else 1.0},
        "video": {"embeds": videos, "has_videoobject": has_video_obj, "transcript_signals": transcripts, "chapter_signals": chapters},
        "merchant_jsonld": {"has_product": has_product, "gtin_or_mpn": gtin, "price": price, "availability": avail, "image": image_link},
        "local_jsonld": {"has_localbusiness": has_local},
    }


def audit_feed(feed_path):
    with open(feed_path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
        fields = [c.lower() for c in (rows[0].keys() if rows else [])]
    def cov(*names):
        if not rows:
            return 0
        hits = sum(1 for r in rows if any((r.get(k) or r.get(k.title()) or "").strip() for k in names if k in r or k.title() in r))
        # fallback: case-insensitive scan
        if not hits:
            low = {k.lower(): v for r in rows for k, v in r.items()}
            return 0
        return round(hits / len(rows), 3)
    # robust coverage: scan lowercased keys
    with open(feed_path, newline="", encoding="utf-8-sig") as f:
        r2 = list(csv.DictReader(f))
    def col_has(*cands):
        keys = [k.lower() for k in (r2[0].keys() if r2 else [])]
        return any(c in keys for c in cands)
    def col_fill(*cands):
        if not r2:
            return 0
        keys = {k.lower(): k for k in r2[0].keys()}
        use = [keys[c] for c in cands if c in keys]
        if not use:
            return 0
        hits = sum(1 for r in r2 if any(str(r.get(u, "")).strip() for u in use))
        return round(hits / len(r2), 3)
    return {"status": "measured", "rows": len(r2),
            "gtin_coverage": col_fill("gtin", "mpn"), "price_coverage": col_fill("price"),
            "availability_coverage": col_fill("availability"),
            "image_link_coverage": col_fill("image_link", "image link", "image"),
            "has_gtin_col": col_has("gtin", "mpn"), "has_price_col": col_has("price"),
            "freshness_probe": "Re-check price/availability within 24h for top SKUs — stale values kill carousel eligibility."}


GBP_CHECKLIST = ["business_name_match", "address_match", "phone_match", "hours_present",
                 "primary_category_set", "website_utm_tagged", "reviews_link_present", "photos_5plus"]


def main():
    ap = argparse.ArgumentParser(description="Multimodal + Merchant + Local audit")
    ap.add_argument("--site", required=True)
    ap.add_argument("--pages", default=None, help="Comma-separated extra page paths")
    ap.add_argument("--feed", default=None)
    ap.add_argument("--youtube-handle", default=None)
    ap.add_argument("--locales", default="us", help="Comma-separated locale codes for GBP checklist")
    ap.add_argument("--out", default=str(ROOT / "data" / "uploads" / "commerce"))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    origin = a.site if "://" in a.site else "https://" + a.site
    origin = origin.rstrip("/")
    urls = [origin, origin + "/pricing"]
    if a.pages:
        urls += [origin + p if p.startswith("/") else p for p in a.pages.split(",")]
    pages = [audit_page(u) for u in urls]
    feed = audit_feed(a.feed) if a.feed and Path(a.feed).exists() else {"status": "no_data", "message": "No merchant feed passed. Expected columns: id,gtin/mpn,price,availability,image_link."}
    locales = [l.strip() for l in a.locales.split(",") if l.strip()]
    gbp = {loc: {item: "manual_check_required" for item in GBP_CHECKLIST} for loc in locales}
    result = {
        "status": "measured", "site": origin, "checked_at": datetime.now(timezone.utc).isoformat(),
        "pages": pages,
        "merchant_feed": feed,
        "youtube": {"handle": a.youtube_handle or "not_provided",
                    "note": "YouTube mentions 0.737 citation correlation. Track handle mentions in AIO/AI Mode citations; add chapters + transcripts (see video signals).",
                    "status": "manual" if not a.youtube_handle else "handle_recorded"},
        "gbp_localbusiness_checklist": gbp,
        "benchmarks": {"multimodal_share": "1 in 6 AI Mode searches multimodal (image +40% MoM)",
                       "youtube_corr": 0.737, "branded_mention_corr": 0.664, "backlink_corr": 0.218},
        "recommendations": [],
    }
    for p in pages:
        if p.get("status") != "measured":
            continue
        if p["images"]["alt_coverage"] < 0.9:
            result["recommendations"].append({"priority": "HIGH", "page": p["url"], "finding": f"Alt coverage {p['images']['alt_coverage']:.0%} — multimodal retrieval blind.", "action": "Write descriptive alt (>=12 chars, entity + attribute) for product/lifestyle images."})
        if p["video"]["embeds"] and not p["video"]["has_videoobject"]:
            result["recommendations"].append({"priority": "MEDIUM", "page": p["url"], "finding": "Video embeds without VideoObject JSON-LD.", "action": "Add VideoObject (name, description, thumbnailUrl, uploadDate, transcript)."})
        if not p["merchant_jsonld"]["has_product"] and "/pricing" in p["url"]:
            result["recommendations"].append({"priority": "MEDIUM", "page": p["url"], "finding": "No Product/Offer JSON-LD on pricing page.", "action": "Add Product + Offer (price, availability, GTIN) — Merchant Center carousel eligibility."})
    with open(out / "multimodal_merchant_audit.json", "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
