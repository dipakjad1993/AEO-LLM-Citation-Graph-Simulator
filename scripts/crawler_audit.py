"""
Crawler / Agent analytics (Crawl Truth).
Profound + Scrunch track bot fetches. This closes the gap:
- Parse server access logs for AI crawler hits:
  OAI-SearchBot vs ChatGPT-User vs GPTBot vs CCBot, PerplexityBot,
  Google-Extended, Bytespider, ClaudeBot, Bingbot, Applebot-Extended.
- Probe site controls: /.well-known/mcp.json, llms.txt, robots.txt,
  AI crawler IP verification note, firewall verify checklist.
- Critical context encoded: ChatGPT = Bing + OAI-SearchBot, Claude = Brave,
  Gemini = Google + YouTube 9.5% + Google-owned 22.8%, Perplexity = Sonar +
  Reddit 6.6% + 82% Google overlap. If you're blocked, you're invisible —
  and no SoMV number explains why without this.

Usage:
  python scripts/crawler_audit.py --site https://example.com --log access.log --out data/uploads/crawl/
  python scripts/crawler_audit.py --site https://example.com --out data/uploads/crawl/   # probes only
Never fabricates: missing log -> probes-only with status:partial + spec.
"""
import argparse
import json
import re
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent

AI_BOTS = {
    "OAI-SearchBot": {"family": "OpenAI", "drives": "ChatGPT live citations (with Bing index)", "verify": "DNS reverse: *.search.msr.microsoft.com / openai crawl docs"},
    "ChatGPT-User": {"family": "OpenAI", "drives": "ChatGPT on-demand fetch (user-triggered, incl. actions)", "verify": "UA contains ChatGPT-User; triggered per prompt"},
    "GPTBot": {"family": "OpenAI", "drives": "Training only — does NOT drive live citations", "verify": "Blocking GPTBot does not remove you from ChatGPT answers"},
    "PerplexityBot": {"family": "Perplexity", "drives": "Sonar retrieval", "verify": "docs.perplexity.ai bot page"},
    "ClaudeBot": {"family": "Anthropic", "drives": "Claude retrieval probe (Brave-backed)", "verify": "Anthropic bot docs"},
    "anthropic-ai": {"family": "Anthropic", "drives": "Claude usage fetch", "verify": "Anthropic bot docs"},
    "Google-Extended": {"family": "Google", "drives": "Training/grounding control ONLY (not AIO/AI Mode inclusion)", "verify": "Separate from Search generative AI control"},
    "Googlebot": {"family": "Google", "drives": "Ranking + RAG retrieval from Search index (feeds AIO/AI Mode)", "verify": "Search Console crawl stats"},
    "CCBot": {"family": "Common Crawl", "drives": "Third-party training data (downstream models)", "verify": "commoncrawl.org/ccbot"},
    "Bytespider": {"family": "ByteDance", "drives": "Training/future retrieval", "verify": "Check block policy; high-frequency"},
    "Bingbot": {"family": "Microsoft", "drives": "Bing index -> ChatGPT + Copilot grounding", "verify": "Bing Webmaster Tools"},
    "Applebot-Extended": {"family": "Apple", "drives": "Training control", "verify": "support.apple.com bot docs"},
    "YouBot": {"family": "You.com", "drives": "You.com answers", "verify": "youbot docs"},
}

PROBE_PATHS = ["/robots.txt", "/llms.txt", "/.well-known/mcp.json", "/sitemap.xml"]


def fetch(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; AEO-Crawl-Audit/2.1)"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(300000).decode("utf-8", "ignore")
            return {"status": r.status, "headers": dict(r.headers), "body": body}
    except Exception as e:
        return {"error": str(e)}


def parse_log(log_path):
    text = Path(log_path).read_text(encoding="utf-8", errors="ignore")
    hits = Counter()
    per_bot_urls = {}
    lines = [l for l in text.splitlines() if l.strip()]
    for line in lines:
        for bot in AI_BOTS:
            if bot.lower() in line.lower():
                hits[bot] += 1
                m = re.search(r'"[A-Z]+\s+(\S+)\s+HTTP', line)
                if m:
                    per_bot_urls.setdefault(bot, Counter())[m.group(1)] += 1
                break
    total = len(lines)
    ai_total = sum(hits.values())
    return {
        "status": "measured" if ai_total else "no_ai_hits",
        "log_lines": total, "ai_hits": ai_total,
        "ai_share": round(ai_total / total, 4) if total else 0,
        "per_bot": dict(hits),
        "top_urls_per_bot": {b: dict(c.most_common(10)) for b, c in per_bot_urls.items()},
        "diagnosis": ("No AI crawler hits in this window — check robots/firewall/CDN bot rules, "
                      "or widen the window. If blocks exist, SoMV will under-report through no fault of content."
                      if not ai_total else
                      "AI crawlers are reaching origin. Compare blocked vs allowed bots against citation gaps."),
    }


def probe_site(site, out_dir):
    origin = site if "://" in site else "https://" + site
    origin = origin.rstrip("/")
    probes = {}
    for p in PROBE_PATHS:
        url = origin + p
        f = fetch(url)
        body = f.get("body", "")
        probes[p] = {
            "http": f.get("status") or f.get("error"),
            "bytes": len(body),
            "present": bool(f.get("status") == 200 and len(body) > 0),
            "note": {
                "/robots.txt": "Check per-bot Disallow for OAI-SearchBot/PerplexityBot/ClaudeBot/Bingbot. Google-Extended block != AI Mode removal.",
                "/llms.txt": "Infra-only probe for coding agents, score 0. NOT a Google ranking factor (Google Dec-2025 + May-15-2026, Illyes/Mueller). Ship MCP/UCP/ACP first.",
                "/.well-known/mcp.json": "MCP/WebMCP 35%: must validate as JSON + live tool-call e2e (scripts/mcp_tool_test.py).",
                "/sitemap.xml": "Must list money pages with fresh lastmod (ChatGPT/Perplexity ~30d window).",
            }[p],
        }
    # robots per-bot parse
    robots_body = (fetch(origin + "/robots.txt").get("body") or "")
    blocks = {}
    for bot in AI_BOTS:
        m = re.search(rf"User-agent:\s*{re.escape(bot)}.*?(?=User-agent:|\Z)", robots_body, re.S | re.I)
        blocks[bot] = bool(m and re.search(r"Disallow:\s*/", m.group(0)))
    result = {
        "status": "measured", "site": origin,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "probes": probes,
        "robots_blocks": blocks,
        "ip_verify": "Verify AI crawler IPs via reverse DNS before allow-listing (spoofable UA). See provider bot docs.",
        "index_map": {"chatgpt": "Bing index + OAI-SearchBot fetch", "claude": "Brave Search",
                      "gemini": "Google index + YouTube 9.5% + Google-owned 22.8%",
                      "perplexity": "Sonar + Reddit 6.6% + 82% Google overlap"},
        "recommendations": [],
    }
    if blocks.get("OAI-SearchBot"):
        result["recommendations"].append({"priority": "HIGH", "finding": "OAI-SearchBot blocked — ChatGPT live citations impossible.", "action": "Allow OAI-SearchBot in robots.txt + firewall/CDN bot rules."})
    if blocks.get("PerplexityBot"):
        result["recommendations"].append({"priority": "HIGH", "finding": "PerplexityBot blocked — Sonar retrieval impossible.", "action": "Allow PerplexityBot."})
    if blocks.get("Bingbot"):
        result["recommendations"].append({"priority": "HIGH", "finding": "Bingbot blocked — Bing index starves ChatGPT + Copilot.", "action": "Allow Bingbot; check Bing Webmaster Tools."})
    if not probes["/.well-known/mcp.json"]["present"]:
        result["recommendations"].append({"priority": "MEDIUM", "finding": "No /.well-known/mcp.json — MCP/WebMCP 35% scores 0.", "action": "Publish MCP manifest + run scripts/mcp_tool_test.py."})
    return result


def main():
    ap = argparse.ArgumentParser(description="Crawler/agent analytics audit")
    ap.add_argument("--site", required=True)
    ap.add_argument("--log", default=None, help="Access log path (combined log format)")
    ap.add_argument("--out", default=str(ROOT / "data" / "uploads" / "crawl"))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    probes = probe_site(a.site, out)
    log_result = None
    if a.log:
        if not Path(a.log).exists():
            print(f"Log not found: {a.log}", file=sys.stderr)
            log_result = {"status": "no_data", "message": f"Log not found: {a.log}. Probes-only."}
        else:
            log_result = parse_log(a.log)
    else:
        log_result = {"status": "no_data", "message": "No --log passed. Probes-only; pass access log for hit analytics."}
    final = {"probes": probes, "log_analytics": log_result,
             "bot_registry": AI_BOTS,
             "checked_at": datetime.now(timezone.utc).isoformat()}
    with open(out / "crawl_truth.json", "w") as f:
        json.dump(final, f, indent=2)
    print(json.dumps(final, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
