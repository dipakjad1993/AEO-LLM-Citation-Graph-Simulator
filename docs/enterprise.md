# Enterprise Guide — Security, Jobs, Trends, SSO/RBAC, Geo, Remediation

## 1. Server security model (`server.js`, raw `http`, no framework)

- 25 MB body cap, constant-time `Authorization: Bearer` compare, traversal blocks,
  static allow-list (`/` → dashboard, `/screenshots/`, `/src/dashboard/` only),
  per-IP rate limit (60 req/min, `MAX_IPS:5000` eviction).
- **CORS**: default is loopback-safe. In production set `AEO_CORS_ORIGIN` to an
  explicit allow-list (comma-separated, e.g. `https://app.example.com,https://admin.example.com`).
  `*` is dev-only and logs a warning on boot; preflight `OPTIONS` is handled with
  `Vary: Origin`. Never ship `*` to prod — it fails Razorfish-style reviews.
- **Correlation IDs / observability**: every request gets `x-request-id`
  (client-supplied or generated) echoed back, included in `logs/server.log` lines
  and `/api/status` output. Set `OTEL_ENABLED=1` + `OTEL_EXPORTER_OTLP_ENDPOINT` to
  emit OTLP-compatible JSONL spans to `logs/otel.jsonl` (no vendor SDK required).
- **Auth**: `AEO_AUTH_TOKEN` required when `NODE_ENV=production` (server refuses to boot
  without it). All `/api/*` except `/api/health` require it.
- **SSO / RBAC (enterprise)**: set `AEO_OIDC_ISSUER`, `AEO_OIDC_AUDIENCE`,
  `AEO_OIDC_JWKS_URL` to enforce OIDC JWTs (verified via JWKS, `kid`-matched) with
  `roles` claim → `admin | analyst | viewer` RBAC matrix (`config/security.json`).
  Without OIDC configured the server runs in single-token mode (dev/SMB) and logs it.
  SCIM provisioning: `POST /api/admin/scim/users` (stub with audit event; wire to IdP).
- **Audit log UI**: `GET /api/audit?limit=100` (auth required) streams the append-only
  `logs/audit.jsonl` (hash-chained). Dashboard → "Audit" tab renders it. Legal can
  verify the chain with `python scripts/verify_manifest.py`.

## 2. Persistent job store (no more in-memory loss)

- `procs{}` / `sessionRunDirs` are now backed by `data/jobs/jobs.json` (atomic write)
  and, when available, SQLite `data/aeo_jobs.db` (`jobs`, `runs`, `audit_events` tables
  via `src/node-orchestrator/job_store.js`). State survives restarts.
- Endpoints: `GET /api/jobs`, `GET /api/runs` (persisted), `GET /api/status?id=…`,
  `GET /api/security` (CORS/SSO/RBAC posture), `GET /api/audit`.
- `POST /api/analyze` enqueues + spawns the Python engine async; poll `/api/status`.

## 3. 90-day trend store (SQLite, not JSON)

- `src/python-engine/analytics/trend_store.py` upserts per-run SoMV/CPR/volatility
  snapshots into `data/trends.db` (`run_snapshots`, `somv_history`, `alerts`).
- Dashboard renders 90-day SoMV / CPR / volatility charts with Wilson CIs from
  `GET /api/trends?days=90` (served from SQLite; falls back to latest JSON).
- Scheduler `--check-alerts` diffs latest vs previous (SoMV drop >15%, competitor
  surge >15%, hallucination spike, CPR <50%, **snippet-blocked fail gate**) and fires
  `SLACK_WEBHOOK_URL`. History chart needs the trend store — enable the daily cron.

## 4. Snippet-blocking fail gate (P0, Google May-15 Guide)

- `SiteAuditor.audit_page` detects `meta robots nosnippet`, `max-snippet:0`,
  `data-nosnippet` → `snippet_eligibility.score=0`, `fail_gate.snippet_blocked=true`.
- Pipeline fails loud (`results.fail_gate`) + Slack alert + HIGH recommendation citing
  the Meltwater May-2026 case (99k → 172k citations, +73% after fixing snippet blocks).
- CI: `python scripts/snippet_gate.py https://example.com/pricing` exits non-zero when blocked.

## 5. Commerce Truth = Stage 0 (revenue hero)

- `CommerceAnalyzer` runs as **Stage 0 preflight** (feed health + ACP/UCP/Rufus) and
  full Stage 12 (product-card tracking). Dashboard hero shows revenue + feed health first.
- GTIN/price/availability/`image_link` missing-field impact simulator:
  `feed_impact_simulator` estimates carousel-eligibility lift per fixed field.
- ACP `checkout_eligibility` live probe: `node scripts/acp_probe.js --cron` (also cron).
- Shopify UCP `native_commerce` badge from `/api/ucp/mcp search_catalog` validation.
- Remediation assets (not just reports): Product Offer JSON-LD drafts + Merchant feed
  CSV fix file in `reports/commerce_fixes/`; one-click PR via `scripts/remediation_pr.py`.

## 6. Traffic join (revenue proof)

- One-click importers: `python scripts/import_traffic.py --gsc gsc.csv --ga4 ga4.csv --bing bing.csv`
  normalizes GSC (`query,clicks,impressions,position,ai_overview_present`),
  GA4 (`source,sessions,conversions,revenue`, `utm_source=chatgpt.com` etc.),
  Bing Webmaster AI Performance GEO export into `data/uploads/traffic/`.
- `TrafficJoin` computes generative-inclusion gate + AI-referrer revenue share;
  CEOs get "LLM referrals convert 2× organic" or an honest `no_data` schema spec.
- Looker Studio template: `docs/looker_studio_template.json` + CSV export
  (`/api/export?format=csv`).

## 7. Third-party dominance (close the Peec gap)

- `ThirdPartyDominance` scores every citing URL: can we **earn / edit / respond** there?
  Reddit/YouTube/G2/Trustpilot fetch + heuristics → `authority_nodes` with
  `owner_email` + pitch draft. Top-10 missing nodes → `reports/outreach_briefs/`.
- Wire `missing_authority_nodes` (graphs) → outreach automation; Goodie-style
  research→revenue loop.

## 8. Geo matrix (cost-flat, honest)

- `geo.countries` splits prompt budget cost-flat; every row tagged `geo` + `location_code`.
- `GeoTemporal` emits EU-vs-US leader split + per-locale GBP/`LocalBusiness` checklist;
  persist weekly to trend store. PDF export: dashboard "Geo" tab → Print/PDF.

## 9. Agent readiness (MCP/UCP/ACP before llms.txt polish)

- Weights: MCP/WebMCP 35% (`/.well-known/mcp.json` probe + JSON validation **+ live tool-call
  e2e**: `scripts/mcp_tool_test.py`), ACP 25%, basics 25%, llms.txt 15% experimental
  ("agents-only convenience; NOT ranking factor" — Illyes/Mueller).
- Standing rec: ship MCP/UCP/ACP before polishing llms.txt.

## 10. Auto-remediation PR mode + benchmark pack

- `python scripts/remediation_pr.py --analysis data/output/analysis_X --apply` opens a
  GitHub PR with fixed FAQPage/Product JSON-LD + updated `dateModified`
  (uses `gh` CLI; dry-run by default, prints diff).
- `node scripts/benchmark_pack.js --questions 50` runs the Stork-style reference
  (grounded rates by engine + Wilson CIs) for backlinks/press/FUD-killing.
- Refresh cadence: `python scripts/refresh_tickets.py` emits Jira/Linear CSV
  ("Refresh /pricing — 34 days old, ChatGPT window expired").

## 11. Python reproducibility (dual-requirements, honest)

- `requirements-lite.txt` (~200 MB, offline MiniLM/keyword + VADER fallbacks) is the default.
- `requirements.txt` adds torch/transformers/UMAP/HDBSCAN + `en_core_web_trf`.
- Pinned: `uv.lock` + `requirements.lock.txt` (hashes). `setup.js` enforces
  `python --version >= 3.11` and prints LITE vs FULL badge.
- Dashboard + `pipeline_meta` badge `Lite mode: transformer sentiment OFF`
  whenever RoBERTa/MiniLM-trf are absent so VADER is never mistaken for RoBERTa.
