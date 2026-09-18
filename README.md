# AEO & LLM Citation Graph Simulator (v2.3) — Open Audit Lab for AI Search Visibility

**AEO (Answer Engine Optimization) + GEO (Generative Engine Optimization): grounded-only Share of Voice, per-engine citation adapters, volatility CIs, and tamper-evident provenance — local-first, against live 2026 LLM APIs.**

<p>
  <a href="https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 22" src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white">
  <img alt="Python 3.11" src="https://img.shields.io/badge/python-3.11-3776AB?logo=python&logoColor=white">
  <img alt="Providers" src="https://img.shields.io/badge/providers-9_incl_SERP-blue">
  <img alt="Pipeline" src="https://img.shields.io/badge/pipeline-Stage_0_%2B_14_stages-orange">
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-open--source-lightgrey">
</p>

> **Live demo (hosted):** https://aeo-llm-citation-graph-simulator-1.onrender.com/ — try it in your browser, no install.
> For private tracking, deploy your own instance, set `AEO_AUTH_TOKEN` plus provider keys (see Quickstart B).
>
> **Source:** https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator — issues and PRs welcome.

**Positioning: if Profound is the Bloomberg Terminal for AI visibility ($1B valuation, $99–$399+/mo), this is the open audit lab.**
Profound, Scrunch/Sitecore (~$225M), Peec (€70–360/mo), and Goodie ($399/mo) sell you scores.
This tool shows you the receipts: the exact responses, citations, browse-evidence flags, volatility intervals,
and tamper-evident manifests behind every metric — running on your machine, against live 2026 model APIs,
for about $0.245 per question × 6 engines (Stork.AI-measured reference, Aug 2026, 925 runs).

> **Evidence standard (read this before quoting numbers): grounded-only, Wilson 95% CIs, manifest-verified.**
> LLMs are non-deterministic, retrieval-augmented, geo-variable, model-drifting systems. No vendor —
> including this lab — can claim "100% verified, correct, accurate" data. Anyone promising that is selling
> scores, not receipts. Every metric here ships with its citations, browse-evidence flags, confidence
> intervals, and a SHA-256 manifest you can re-verify.

> **2-minute, $0, zero-key proof of value:**
> ```bash
> npm install && pip install -r requirements-lite.txt
> python -m spacy download en_core_web_sm
> npm run demo   # keyless demo_synthetic corpus -> Stage 0 + 14 stages -> dashboard + recommendations
> ```
> Demo rows are labelled `demo_synthetic`, written to `data/output/run_demo_synthetic_QUARANTINED/`,
> and quarantined from prod analysis by default (the demo runner opts in via `AEO_ALLOW_SYNTHETIC=1` only).
> Any other `run_*` dir containing synthetic rows **fails loud** instead of silently polluting SoMV.
> The dashboard renders a red `SYNTHETIC - NOT PROD EVIDENCE` banner on quarantine runs.
> `seed_demo_data.py` is excluded from the prod Docker image via `.dockerignore`.

![Landing](screenshots/landing-hero.png)
![Dashboard](screenshots/dashboard-overview.png)

## Why teams pick this (the moat — covered by eval goldens, do not regress)

| # | Capability | What it means |
|---|---|---|
| 1 | **Grounded-only SoMV** | `search_requested` vs `search_performed` split; SoMV recomputed on browse-evidenced rows only, Wilson 95% CIs, `LOW_BROWSE_RATE` (<50%) and `BELOW_BENCHMARK_74` flags |
| 2 | **Per-engine citation adapters** | OpenAI `annotations[]`/`sources[]`, Anthropic `web_search_tool_result`, Gemini redirect resolver (HEAD + Range fallback, cached), Perplexity flat `citations[]`, UTM-strip + canonicalization on ALL adapters, `search_contaminated_baseline` flag on RAG-off twins |
| 3 | **No fabrication, ever** | Missing text → `success:false + unusable_reason`; absent inputs → `status:no_data` + schema spec. Guarded by 19 eval goldens |
| 4 | **CPR + G_auth + parity** | Multi-turn Citation Persistence Rate, `G_auth = 0.4*C_D + 0.35*C_B + 0.25*S_cons`, API/UI parity flag at >15% variance (Playwright is a ≤15% control group only) |
| 5 | **Tamper-evident provenance** | SHA-256 run manifest + append-only JSONL audit + PII redact/hash-only mode. Verify: `python scripts/verify_manifest.py data/output/<run>` or `GET /api/verify?run=...` |
| 6 | **Cost honesty** | ~$0.245/question × 6 engines, $500/day hard budget, `max_calls_per_run:2500`, Grok `search_cost` preserved and billed, cost-flat multi-country geo, pre-flight budget preview in the UI |

Methodology detail: [`docs/methodology.md`](docs/methodology.md) (read before changing analytics).

## Quickstart

| Path | Command | Notes |
|---|---|---|
| A. Keyless demo | `npm run demo` | Synthetic, quarantined (see above). Mirrors CI |
| B. Real tracking | `node setup.js` then `npm run full-run` | Validates each key live; enforces Python ≥3.11; needs 1+ provider key |
| B2. Scale + sharding | `node src/node-orchestrator/index.js --scale pilot\|standard\|enterprise --prompts 50 --shard 1/4` | Enterprise = 5,000 sessions sharded; pre-flight budget gate refuses over-budget runs (`docs/enterprise.md` §12) |
| B3. Auto-onboard | `python scripts/auto_onboard.py --domain https://YOUR-SITE/` or UI ⚡ button / `GET /api/onboard?domain=` | Sitemap crawl → 20 money prompts + heuristic competitors + snippet/schema/robots preflight |
| C. Server UI/API | `AEO_AUTH_TOKEN=... node server.js` | `http://localhost:3000`, probe `/api/health` |
| D. Docker | `docker compose up --build` | Sets `HOST=0.0.0.0`; demo seeder excluded from image |
| E. Static UI + hosted backend | Cloudflare Pages + Render/Docker | Set `AEO_CORS_ORIGIN=https://YOUR-PAGES-URL` on backend; open Pages URL once as `?api=https://YOUR-BACKEND` (`&token=...` if auth set) |

Provider keys: OpenAI, Anthropic, Google, Perplexity, DeepSeek, xAI (`XAI_API_KEY`), SERP (`SERP_API_KEY` + `SERP_PROVIDER=serper|dataforseo|zenserp`).

## System Inputs — the 6 layers (UI mirrors this exactly)

| Layer | What you configure | 2026 truth enforced in UI |
|---|---|---|
| 1. Brand & competitors | Name, site, category + intent, Wikidata QID, KG MID, aliases, locale, YMYL vertical | Entity resolution (no "Apple the fruit" false matches); aliases feed `entity_maps.json`; one-click auto-discover |
| 2. Query Fan-Out Lab | Observed (tool traces) vs Simulated (SERP) mode, SERP provider, depth 1–5, allowed/blocklist, date restrict, location passthrough | Honest label: APIs can't expose true server-side fan-out; DeepSeek = memory-only warning |
| 3. Temporal grounding | Freshness timestamp (or sitemap-lastmod autofill), baseline/current from live `/api/models` registry, freshness window 30d/quarter/year | Deprecated snapshots (e.g. `gpt-4o-2024-*`, shutdown 2026-07-23) refused by `migrate:check` + server guard; >15% drift with unchanged site = "model re-indexing, not your site" |
| 4. Geo localization | Market chips with DataForSEO `location_code`, budget split, EU/US view, GBP checklist | **No secrets in browser** — proxy creds in `PROXY_URL`/`AEO_PROXY_<MARKET>` env only; GDPR note for EU |
| 5. Execution | Live engine matrix, scale (pilot/standard/enterprise), prompts, concurrency, temp ≤0.2, seed, grounding mode (Grounded/Memory/Dual) | Budget preview (~$0.245/q) with $500 hard-gate messaging before Save & Start |
| 6. Revenue Truth + files | GSC Generative AI / GA4 AI-source / Bing CSVs, OAuth pull, run picker + diff, retention note | CEO line first: AI-referrer revenue share, assisted conversions, gap note |

## What you get (2026-enterprise feature set)

- **Stage 0 Commerce preflight + Commerce Truth:** feed health, GTIN/price/availability/`image_link` simulator, ACP `checkout_eligibility` probe (`node scripts/acp_probe.js --cron`), Shopify UCP `native_commerce` badge, fix assets (`product_offer.jsonld` + `merchant_feed_fix.csv`); dashboard Commerce+Local tab + `GET /api/commerce-local`
- **Revenue proof:** importers (`python scripts/import_traffic.py --gsc g.csv --ga4 g.csv --bing b.csv`), generative-inclusion gate, AI-referrer revenue share, `/api/export?format=csv` + Looker Studio template (`docs/looker_studio_template.json`, live connector in `docs/looker_live.md`)
- **Snippet fail gate (P0, Google May-15 Guide):** `nosnippet`/`max-snippet:0`/`data-nosnippet` → score 0 + Slack alert + HIGH recommendation; CI gate: `python scripts/snippet_gate.py https://YOUR-SITE/pricing`
- **90-day trends hero (SQLite, not JSON):** `analytics/trend_store.py` → `data/trends.db` (run snapshots, `citation_history`, sentiment-model versions, geo splits); `GET /api/trends?days=90`; scheduler diffs + Slack (SoMV drop >15%, competitor surge >15%, CPR <50%, volatility HIGH, snippet-blocked)
- **Content Graveyard (Somantra Aug-2026 replication):** 57.2% one-and-done benchmark, comparison/FAQ/discount 2× persistence, complete-guide 3.5× vanish risk (`analytics/content_graveyard.py`); `GET /api/graveyard`
- **Third-party dominance engine:** earn/edit/respond scoring per citing URL, owner + pitch draft, top-10 `missing_authority_nodes`, `reports/outreach_briefs/*.md`; `GET /api/third-party`
- **Agent readiness, Google-compliant:** MCP/WebMCP 40% + live tool-call e2e (`python scripts/mcp_tool_test.py <site>`), ACP 30%, basics 30%, **`llms.txt` 0% info-only** (NOT a Google ranking factor per Dec-2025 + May-15-2026 Guide; infra convenience for coding agents only)
- **Geo matrix that doesn't lie:** cost-flat budget split, `location_code` rows, EU-vs-US split, per-locale GBP/`LocalBusiness` checklist
- **Remediation + benchmark:** `python scripts/remediation_pr.py --analysis ... [--apply|--apply-factcheck]` (GitHub PR with fixed JSON-LD + `dateModified` + FactCheck corrections), `node scripts/benchmark_pack.js` (Stork-style grounded-rate), `python scripts/refresh_tickets.py` (Jira/Linear)
- **Freshness enforcement:** ChatGPT/Perplexity ~30d, Claude ~quarter, AIO ~year windows with auto-tickets; `dateModified` + FactCheck loop (7.9% benchmark)
- **Google Truth (GSC Generative AI connector):** `python scripts/gsc_genai_pull.py` (Generative AI report page/country/device/date + Web Performance side-by-side, `--audit-controls`); `GET /api/google-truth`; [`docs/google-truth.md`](docs/google-truth.md)
- **Surfaces split hero (never averaged):** AIO vs AI Mode vs Gemini as three surfaces (`analytics/surface_split.py`, 13.7% overlap + Reddit/YouTube split) + volume-weighted SoMV (`scripts/prompt_miner.py` + `analytics/prompt_volumes.py`); `GET /api/surfaces`, `GET /api/prompt-volumes`
- **Fan-out + ACE:** reformulation-failure view (`GET /api/fanout`) + `P(cite)` uplift levers fitted on your run only (`analytics/ace_predictor.py` — not a Google guarantee)
- **Crawl Truth + FactCheck loop:** `python scripts/crawler_audit.py` (OAI-SearchBot vs ChatGPT-User vs GPTBot, PerplexityBot, Google-Extended + MCP/robots/llms.txt probes) + `analytics/factcheck_loop.py`; `GET /api/crawl`
- **Attribution 2.0:** `python scripts/attribution_enhanced.py` (UTM auto-tagging for 11 AI surfaces, GA4 join, AI-vs-organic lift, assisted conversions)
- **Multimodal + Merchant + Local:** `python scripts/multimodal_merchant_audit.py` (image alt, VideoObject/transcripts/chapters, GTIN/price/availability, GBP checklist; YouTube 0.737 correlation)
- **Registry hygiene:** `node scripts/migrate_deprecated.js --check|--migrate` + server-side deprecated guard + `/api/models` registry dropdowns; Meta AI, Rufus, Copilot chat, ChatGPT-User action stay `scheduled:false` until verified
- **MCP surface:** every GET truth endpoint is an MCP tool (`GET /api/mcp`); Looker Studio live connector beyond the static template

Pipeline: **Stage 0 Commerce preflight** → 14 stages (attribution, triples, verification, graphs, SoMV, embeddings, sentiment, enterprise/CPR, site audit, agent readiness, volatility, third-party/geo, commerce+traffic, dashboard, recommendations) → SQLite trends + Slack alerts.

## API reference (all GETs are MCP tools)

| Endpoint | Purpose |
|---|---|
| `/api/health` | Liveness + engine matrix + key presence (no auth) |
| `/api/models` | Live registry v2026.09: schedulable models, deprecated + shutdown badges, UNVERIFIED candidates, cost reference |
| `/api/onboard?domain=` | Sitemap → money prompts + competitors + aliases + lastmod + snippet/schema/robots preflight |
| `/api/config` (GET/POST) | System inputs; POST strips proxy secrets, refuses deprecated snapshots + placeholder domains |
| `/api/upload/:section`, `/api/uploads` | sections: prompts, entities, corpus, gold_standards, system_config, results, traffic, crawl, commerce (25MB cap; large GSC/GA4 via CLI) |
| `/api/analyze`, `/api/status?id=`, `/api/jobs`, `/api/runs` | Pipeline lifecycle (persistent jobs survive restart: SQLite `data/aeo_jobs.db`) |
| `/api/results?include=summary` | Latest slim summary (`summary`/`html`/`full`, paginated) |
| `/api/trends?days=90` | SQLite series + alerts + geo splits + sentiment versions |
| `/api/surfaces`, `/api/prompt-volumes`, `/api/graveyard`, `/api/third-party` | Hero intelligence views |
| `/api/fanout`, `/api/ace`, `/api/crawl`, `/api/google-truth`, `/api/commerce-local` | Retrieval, prediction, crawl, revenue, merchant views |
| `/api/verify?run=` | SHA-256 manifest re-verification |
| `/api/export?format=json\|csv\|jsonl` | Looker/Sheets CSV, full JSONL dump |
| `/api/audit?limit=` | Hash-chained audit events (admin/analyst) |
| `/api/security` | CORS, auth/RBAC, playwright parity, budgets, proxy-env status, location codes |
| `/api/admin/retention`, `/api/admin/scim/users` | Retention matrix (admin), SCIM stub (admin, audit-logged) |
| `/api/mcp` | MCP tool manifest for the above |

## Security posture (framework-free `server.js`, enterprise-ready)

- 25MB body cap, constant-time token compare, traversal blocks, allow-listed static, 60 req/min/IP (`MAX_IPS:5000` eviction); `NODE_ENV=production` refuses to boot without `AEO_AUTH_TOKEN`
- CORS allow-list (`AEO_CORS_ORIGIN`, comma-separated; `*` is dev-only with boot warning)
- Proxy secrets **never in browser/config**: `PROXY_URL` / `AEO_PROXY_<MARKET>` env only; `/api/config` strips posted secrets and logs the count
- Correlation IDs (`x-request-id` echoed, file+OTLP JSONL via `OTEL_ENABLED=1`), persistent jobs, audit chain, retention policy (`docs/retention.md`)
- SSO/RBAC: real JWKS verify (kid-matched, iss/aud/exp) via `AEO_OIDC_ISSUER/AUDIENCE/JWKS_URL` + matrix (`config/security.json`: `admin|analyst|viewer`) on ALL mutating routes; see [`docs/enterprise.md`](docs/enterprise.md)

## Docs (deep dives)

- [`docs/methodology.md`](docs/methodology.md) — grounded SoMV, adapters, CPR/G_auth/parity, provenance, cost, volatility
- [`docs/providers.md`](docs/providers.md) — 2026 registry, unverified late-2026 candidates + nightly verifier, Playwright parity-only + ToS warning, SERP surfaces
- [`docs/enterprise.md`](docs/enterprise.md) — security, jobs, trends, snippet gate, commerce, traffic, outreach, geo, agent readiness, PR mode, benchmark, Lite-vs-Full
- [`docs/google-truth.md`](docs/google-truth.md) — GSC Generative AI connector + controls audit
- [`docs/retention.md`](docs/retention.md) — procurement-ready retention/export/delete matrix
- [`docs/looker_live.md`](docs/looker_live.md) — live Looker Studio connector beyond the static template

## Tests & verification (CI gates — keep them green)

```bash
node --test src/node-orchestrator/utils/unitTests.js   # 24 adapter/provenance/quality tests (CI)
python src/python-engine/tests/test_eval_goldens.py    # 19 no-fabrication/methodology goldens (CI)
python -u seed_demo_data.py                            # CI: seeds quarantined demo corpus
AEO_ALLOW_SYNTHETIC=1 python -u src/python-engine/main.py --run-dir data/output/run_demo_synthetic_QUARANTINED  # CI: full demo pipeline
python src/python-engine/tests/test_verification.py    # claim-verification checks (dev)
npm run migrate:check                                  # deprecated-ID scheduler guard
npm run validate                                       # LOCAL readiness gate (needs .env + real brand; not CI)
python scripts/verify_manifest.py data/output/<run>   # provenance check
node scripts/verify_model_registry.js                  # provider-ID drift (add --strict in CI/cron)
npm run demo                                           # full quarantined pipeline (mirrors CI)
```

Python: `requirements-lite.txt` is the default (~200MB, MiniLM/keyword + VADER fallbacks); `requirements.txt` adds torch/transformers/UMAP/HDBSCAN. Pinned in `uv.lock` / `requirements.lock.txt`. Requires Python ≥3.11. The dashboard badges `Lite mode: transformer sentiment OFF` whenever heavy ML is absent, and the trend store versions the sentiment model per run so VADER rows never compare to RoBERTa historically.

## Contributing

PRs welcome at https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator. Keep the moat green:
`docs/methodology.md` first, fixture-first for adapter changes, `AEO_ALLOW_SYNTHETIC` quarantine intact,
and `node --test ...unitTests.js` + `test_eval_goldens.py` + the quarantined demo pipeline passing before you push.
