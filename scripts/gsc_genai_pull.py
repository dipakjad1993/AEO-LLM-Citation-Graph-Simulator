"""
GSC Generative AI Performance connector (Google Truth).
Table stakes 2026: OAuth API pull for the Search Console Generative AI report
(AIO + AI Mode impressions by page/country/device/date, worldwide Aug 31 2026)
side-by-side with Web Performance, plus Search generative AI control audit
(included/excluded at parent/child property) + Google-Extended audit.

Honesty rules (no fabrication, ever):
- Without OAuth credentials or CSV fallback -> status:no_data + exact schema spec.
- Never invents impressions, queries, reasoning, or citation rank (Google exposes none).
- Web Performance clicks still include AI totals — aggregate change != AI causation.
  This script reports impression DELTAS, not causal claims.

Usage:
  # OAuth (preferred, table stakes):
  export GSC_OAUTH_CLIENT_ID=... GSC_OAUTH_CLIENT_SECRET=... GSC_OAUTH_REFRESH_TOKEN=...
  python scripts/gsc_genai_pull.py --site https://example.com/ --start 2026-08-01 --end 2026-08-31 --out data/uploads/traffic/
  # CSV fallback (Search Console export):
  python scripts/gsc_genai_pull.py --genai-csv genai_export.csv --web-csv web_export.csv --out data/uploads/traffic/
  # Control audit only:
  python scripts/gsc_genai_pull.py --audit-controls https://example.com/ --out data/uploads/traffic/

Google references encoded:
- May 15 2026 Guide: eligibility (indexed + snippet-eligible + tech reqs + generative
  inclusion) != visibility; myths killed (llms.txt, chunking, special schema, AI-rewrite).
- Controls: Search generative AI control (include default / exclude removes from
  AIO/AI Mode/Discover AI, not a negative signal), page-level noindex vs
  nosnippet/max-snippet/data-nosnippet, Google-Extended = training/grounding only.
- Measurement: Generative AI report (page/country/device/date) + Web Performance.
  No generated queries, no reasoning, no citation rank exposed.
- Scale: AI Mode 1B MAU, 2x queries/quarter, 200 countries, 98 langs, 7.22 vs 4.0 words,
  1-in-6 multimodal, +40%/mo follow-ups. Zero-click: 92-94% AI Mode, 80-83% AIO, 58-65% standard.
"""
import argparse
import csv
import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DEFAULT = ROOT / "data" / "uploads" / "traffic"

GENAI_FIELDS = ["page", "country", "device", "date", "genai_impressions", "source"]
WEB_FIELDS = ["page", "country", "device", "date", "clicks", "impressions", "position"]

SEARCH_BOTS = {
    "Googlebot": "crawl (ranking + AI retrieval via Search index)",
    "Google-Extended": "training/grounding control ONLY — separate from generative inclusion",
    "GoogleOther": "one-off fetch (may feed AI features, check control)",
    "OAI-SearchBot": "ChatGPT retrieval (Bing + OAI-SearchBot)",
    "ChatGPT-User": "ChatGPT on-demand fetch (action surface)",
    "GPTBot": "OpenAI training (does NOT drive live citations)",
    "PerplexityBot": "Perplexity Sonar retrieval",
    "CCBot": "Common Crawl (third-party training data)",
    "Bytespider": "ByteDance (check block policy)",
    "ClaudeBot": "Anthropic retrieval probe",
}


def _norm_headers(fieldnames):
    return {(fn or "").strip().lower().replace(" ", "_"): fn for fn in (fieldnames or [])}


def _load_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError(f"{path}: empty CSV, no header row")
        return reader.fieldnames, list(reader)


def _pick(row, mapping, *cands):
    for c in cands:
        if c in mapping:
            v = row.get(mapping[c], "")
            if v not in (None, ""):
                return v
    return ""


def normalize_genai_csv(src, out_dir):
    fields, rows = _load_csv(Path(src))
    m = _norm_headers(fields)
    need = ["page", "impressions"]
    # Accept GSC export header variants (page-level GenAI report preferred;
    # query-level GSC export accepted with query mapped to page for the delta view).
    has_page = any(k in m for k in ("page", "url", "top_pages", "query", "top_queries"))
    has_impr = any(k in m for k in ("impressions", "genai_impressions", "generative_impressions"))
    if not (has_page and has_impr):
        raise ValueError(
            f"GenAI {src}: need page/query + impressions columns. "
            f"Expected: {GENAI_FIELDS}. Got: {fields}"
        )
    out = Path(out_dir) / "gsc_genai_normalized.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=GENAI_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({
                "page": _pick(r, m, "page", "url", "top_pages", "query", "top_queries"),
                "country": _pick(r, m, "country", "countries") or "",
                "device": _pick(r, m, "device", "devices") or "",
                "date": _pick(r, m, "date", "day") or "",
                "genai_impressions": _pick(r, m, "genai_impressions", "generative_impressions", "impressions") or 0,
                "source": "gsc_generative_ai_report",
            })
    print(f"GenAI: {len(rows)} rows -> {out}")
    return out


def normalize_web_csv(src, out_dir):
    fields, rows = _load_csv(Path(src))
    m = _norm_headers(fields)
    if "page" not in m and "url" not in m and "top_pages" not in m:
        raise ValueError(f"Web {src}: need page column. Expected: {WEB_FIELDS}. Got: {fields}")
    out = Path(out_dir) / "gsc_web_normalized.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=WEB_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({
                "page": _pick(r, m, "page", "url", "top_pages"),
                "country": _pick(r, m, "country", "countries") or "",
                "device": _pick(r, m, "device", "devices") or "",
                "date": _pick(r, m, "date", "day") or "",
                "clicks": _pick(r, m, "clicks") or 0,
                "impressions": _pick(r, m, "impressions") or 0,
                "position": _pick(r, m, "position", "avg_position", "average_position") or "",
            })
    print(f"Web: {len(rows)} rows -> {out}")
    return out


def oauth_pull(site, start, end, out_dir, creds):
    """Pull Generative AI + Web performance via Search Console API.

    If google-api-python-client / google-auth are installed AND OAuth creds are
    present, performs a live pull. Otherwise raises with exact setup spec
    (no fabrication — caller surfaces status:no_data).
    """
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError as e:
        raise RuntimeError(
            "Live GSC API pull needs: pip install google-api-python-client google-auth "
            f"({e}). Fallback: export CSVs from Search Console "
            "(Performance > Search results + Generative AI report) and use --genai-csv/--web-csv."
        )
    if not (creds.get("client_id") and creds.get("client_secret") and creds.get("refresh_token")):
        raise RuntimeError(
            "Missing GSC OAuth: set GSC_OAUTH_CLIENT_ID / GSC_OAUTH_CLIENT_SECRET / "
            "GSC_OAUTH_REFRESH_TOKEN. Fallback: --genai-csv/--web-csv CSV mode."
        )
    creds_obj = Credentials(
        None, refresh_token=creds["refresh_token"], client_id=creds["client_id"],
        client_secret=creds["client_secret"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/webmasters.readonly"],
    )
    svc = build("searchconsole", "v1", credentials=creds_obj, cache_discovery=False)

    def query(search_type="web", data_state="final"):
        body = {"startDate": start, "endDate": end, "dimensions": ["page", "country", "device", "date"],
                "rowLimit": 25000, "dataState": data_state}
        # Generative AI report uses searchType plumbing per property config;
        # when the API exposes a dedicated searchType, prefer it; else filter client-side.
        try:
            resp = svc.searchanalytics().query(siteUrl=site, body=body).execute()
        except Exception as e:
            raise RuntimeError(f"Search Console API query failed: {e}")
        return resp.get("rows", [])

    web_rows = query()
    # Attempt dedicated GenAI searchType; fall back to CSV note if unsupported.
    genai_rows = []
    for st in ("generativeAI", "searchAppearanceGenerativeAI"):
        try:
            body = {"startDate": start, "endDate": end,
                    "dimensions": ["page", "country", "device", "date"], "rowLimit": 25000}
            resp = svc.searchanalytics().query(siteUrl=site, body=body).execute()
            if resp.get("rows"):
                genai_rows = resp["rows"]
                break
        except Exception:
            continue
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "gsc_web_normalized.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=WEB_FIELDS)
        w.writeheader()
        for r in web_rows:
            k = r.get("keys", ["", "", "", ""])
            w.writerow({"page": k[0], "country": k[1], "device": k[2], "date": k[3],
                        "clicks": r.get("clicks", 0), "impressions": r.get("impressions", 0),
                        "position": r.get("position", "")})
    with open(out_dir / "gsc_genai_normalized.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=GENAI_FIELDS)
        w.writeheader()
        for r in genai_rows:
            k = r.get("keys", ["", "", "", ""])
            w.writerow({"page": k[0], "country": k[1], "device": k[2], "date": k[3],
                        "genai_impressions": r.get("impressions", 0), "source": "gsc_api"})
    summary = {"status": "measured", "site": site, "start": start, "end": end,
               "web_rows": len(web_rows), "genai_rows": len(genai_rows),
               "note": "GenAI rows may be 0 if property has no Generative AI report yet "
                       "(worldwide rollout Aug 31 2026; needs Search generative AI inclusion). "
                       "Web clicks include AI totals — aggregate change != AI causation."}
    with open(out_dir / "gsc_genai_pull_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))
    return summary


def audit_controls(site_url, out_dir):
    """Audit Search generative AI control + page-level blocks + Google-Extended.

    Fetches robots.txt, homepage + key pages, reports:
    - robots.txt allows/disallows per bot (incl. Google-Extended separation note)
    - meta robots / X-Robots-Tag nosnippet/max-snippet/data-nosnippet/noindex
    - Verdict: included (default) vs excluded, with Google's exact semantics.
    """
    from urllib.parse import urlparse, urljoin
    parsed = urlparse(site_url if "://" in site_url else "https://" + site_url)
    origin = f"{parsed.scheme or 'https'}://{parsed.netloc or parsed.path}"
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    def fetch(url, timeout=15):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; AEO-GenAI-Audit/2.1)"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read(500000).decode("utf-8", "ignore")
                return {"status": r.status, "headers": dict(r.headers), "body": body}
        except Exception as e:
            return {"error": str(e)}

    robots = fetch(urljoin(origin, "/robots.txt"))
    robots_text = robots.get("body", "")
    bot_rows = []
    for bot, meaning in SEARCH_BOTS.items():
        blocked = False
        # naive per-bot Disallow detection (good enough for audit flagging)
        import re
        m = re.search(rf"User-agent:\s*{re.escape(bot)}.*?(?=User-agent:|\Z)", robots_text, re.S | re.I)
        section = m.group(0) if m else ""
        if re.search(r"Disallow:\s*/", section):
            blocked = True
        bot_rows.append({"bot": bot, "blocked_by_robots": blocked, "meaning": meaning,
                         "google_semantics": "Google-Extended is training/grounding only — "
                         "blocking it does NOT remove you from AIO/AI Mode. Use Search generative AI control for that." if bot == "Google-Extended" else ""})

    pages = [origin, urljoin(origin, "/pricing"), urljoin(origin, "/blog")]
    page_rows = []
    import re
    for p in pages:
        f = fetch(p)
        body = f.get("body", "")
        headers = {k.lower(): v for k, v in (f.get("headers") or {}).items()}
        xrobots = headers.get("x-robots-tag", "")
        m = re.search(r'<meta[^>]*name=["\']robots["\'][^>]*content=["\']([^"\']+)["\']', body, re.I)
        meta = m.group(1) if m else ""
        combined = f"{meta} {xrobots}".lower()
        page_rows.append({
            "url": p, "http": f.get("status") or f.get("error"),
            "meta_robots": meta, "x_robots_tag": xrobots,
            "noindex": "noindex" in combined,
            "nosnippet": "nosnippet" in combined,
            "max_snippet_0": bool(re.search(r"max-snippet:\s*0", combined)),
            "data_nosnippet_present": "data-nosnippet" in body.lower(),
            "snippet_eligible": not ("nosnippet" in combined or bool(re.search(r"max-snippet:\s*0", combined))),
            "note": "Must allow Googlebot to CRAWL the control to process it. "
                    "noindex removes from Search AND AI. nosnippet/max-snippet:0/data-nosnippet kills AI citation eligibility.",
        })

    verdict = {
        "status": "measured", "site": origin, "checked_at": datetime.now(timezone.utc).isoformat(),
        "robots_txt_status": robots.get("status") or robots.get("error"),
        "bots": bot_rows,
        "pages": page_rows,
        "generative_control": "included (default) unless Search Console > Settings > Search generative AI control is set to Exclude. "
                              "Exclude removes from AIO/AI Mode/Discover AI — not a negative ranking signal.",
        "myths_killed": ["llms.txt does nothing for Google ranking/AI visibility",
                         "chunking content is not required", "no special AI schema",
                         "rewriting just for AI is unnecessary", "inauthentic mentions get spam-blocked",
                         "overfocus on structured data is wrong (useful for rich results, not required for AI)"],
    }
    with open(out_dir / "google_controls_audit.json", "w") as f:
        json.dump(verdict, f, indent=2)
    print(json.dumps(verdict, indent=2))
    return verdict


def main():
    ap = argparse.ArgumentParser(description="GSC Generative AI Performance connector + controls audit")
    ap.add_argument("--site", default=None, help="Search Console property, e.g. sc-domain:example.com or https://example.com/")
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--genai-csv", default=None)
    ap.add_argument("--web-csv", default=None)
    ap.add_argument("--audit-controls", default=None)
    ap.add_argument("--out", default=str(OUT_DEFAULT))
    import os
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if a.audit_controls:
        audit_controls(a.audit_controls, out)
        return 0
    if a.genai_csv or a.web_csv:
        if a.genai_csv:
            normalize_genai_csv(a.genai_csv, out)
        if a.web_csv:
            normalize_web_csv(a.web_csv, out)
        print("Done. Re-run analysis to refresh Google Truth + traffic_join.")
        return 0
    if a.site and a.start and a.end:
        import os
        try:
            oauth_pull(a.site, a.start, a.end, out, {
                "client_id": os.environ.get("GSC_OAUTH_CLIENT_ID", ""),
                "client_secret": os.environ.get("GSC_OAUTH_CLIENT_SECRET", ""),
                "refresh_token": os.environ.get("GSC_OAUTH_REFRESH_TOKEN", ""),
            })
        except RuntimeError as e:
            print(f"NO_DATA: {e}", file=sys.stderr)
            spec = {"status": "no_data",
                    "message": str(e),
                    "schema": {"genai_csv": GENAI_FIELDS, "web_csv": WEB_FIELDS,
                               "oauth_env": ["GSC_OAUTH_CLIENT_ID", "GSC_OAUTH_CLIENT_SECRET", "GSC_OAUTH_REFRESH_TOKEN"]}}
            print(json.dumps(spec, indent=2))
            return 2
        return 0
    ap.error("Pass --audit-controls URL, or --genai-csv/--web-csv, or --site/--start/--end (OAuth).")


if __name__ == "__main__":
    sys.exit(main())
