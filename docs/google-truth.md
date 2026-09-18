# Google Truth — Generative AI Performance Connector

Table stakes 2026 (Goodie/Scrunch beat CSV-only tools on "revenue proof").

## Pull

```bash
# OAuth API (preferred)
export GSC_OAUTH_CLIENT_ID=... GSC_OAUTH_CLIENT_SECRET=... GSC_OAUTH_REFRESH_TOKEN=...
python scripts/gsc_genai_pull.py --site sc-domain:example.com --start 2026-08-01 --end 2026-08-31 --out data/uploads/traffic/

# CSV fallback (Search Console exports)
python scripts/gsc_genai_pull.py --genai-csv genai_export.csv --web-csv web_export.csv --out data/uploads/traffic/

# Controls audit (generative inclusion + Google-Extended separation)
python scripts/gsc_genai_pull.py --audit-controls https://example.com/ --out data/uploads/traffic/
```

## What it produces

- `gsc_genai_normalized.csv` (page/country/device/date/genai_impressions) + `gsc_web_normalized.csv` (clicks/impressions/position)
- `gsc_genai_pull_summary.json` + `google_controls_audit.json` (robots per-bot, meta/X-Robots-Tag snippet flags, myths-killed list)
- Dashboard tab **Google Truth** + live `GET /api/google-truth`

## Rules (Google May-15 Guide + Aug-31 worldwide rollout)

- Generative AI report: AIO + AI Mode impressions by page/country/device/date. No generated queries, no reasoning, no citation rank.
- Web Performance clicks still include AI totals — aggregate change ≠ AI causation. Report impression DELTAS.
- Eligibility (indexed + snippet-eligible + tech reqs + generative inclusion via Search Console) ≠ visibility.
- Controls: Search generative AI control (include default; exclude removes from AIO/AI Mode/Discover AI, not a negative signal); page noindex vs nosnippet/max-snippet/data-nosnippet (allow Googlebot to crawl the control); Google-Extended = training/grounding only.
- Myths killed: llms.txt, chunking, special AI schema, AI-rewrite, inauthentic mentions (spam), structured-data overfocus.
