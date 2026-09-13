# AEO & LLM Citation Graph Simulator — v2.1

### The open, auditable, technical-SEO source of truth for AI search. Local-first. No black boxes. Every number traces to a real response.

> **🚀 Live demo: https://aeo-llm-citation-graph-simulator-1.onrender.com/** — try the hosted tool in your
> browser, no install needed. (For private/real tracking runs, deploy your own instance — see Path D below —
> and set `AEO_AUTH_TOKEN` plus your provider keys.)

<p>
  <img alt="Node 22" src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white">
  <img alt="Python 3.11" src="https://img.shields.io/badge/python-3.11-3776AB?logo=python&logoColor=white">
  <img alt="Providers" src="https://img.shields.io/badge/providers-9 incl. SERP-blue">
  <img alt="Pipeline stages" src="https://img.shields.io/badge/pipeline-14 stages + commerce/traffic-orange">
  <img alt="Tests" src="https://img.shields.io/badge/tests-18 node + 12 eval-goldens-green">
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-open--source-lightgrey">
</p>

**If Profound is the Bloomberg Terminal for AI visibility ($1B valuation, $99–$399+/mo), this is the open audit lab.**
Profound, Scrunch (acquired by Sitecore ~$225M, June 2026), Peec (€70–€360/mo, ~$10M ARR), and Goodie ($399/mo)
sell you scores. This tool shows you the *receipts*: the exact responses, citations, browse-evidence flags,
robots rules, volatility intervals, and tamper-evident manifests behind every metric — running on your machine,
against live 2026 model APIs, for the price of API tokens (~24.5¢ per question × 6 engines).

> **2-minute, $0, zero-key proof of value:**
> ```bash
> npm install && pip install -r requirements-lite.txt
> python -m spacy download en_core_web_sm
> npm run demo   # seeds labelled demo_synthetic corpus (168 rows) → runs all 14 stages → dashboard + 33 recommendations
> ```
> Demo rows are labelled `demo_synthetic` and **quarantined from prod analysis by default** — the demo
> runner opts in via `AEO_ALLOW_SYNTHETIC=1`. Analyzing any other `run_*` dir with synthetic rows fails
> loud instead of silently polluting SoMV.

![Landing](screenshots/landing-hero.png)
![Dashboard](screenshots/dashboard-overview.png)

---

## Table of contents

1. [Why this exists (the 2026 competitive reality)](#1-why-this-exists-the-2026-competitive-reality)
2. [What you get: capability map](#2-what-you-get-capability-map)
3. [Quickstart (3 paths: demo, real, docker)](#3-quickstart-3-paths-demo-real-docker)
4. [How it works: architecture & data flow](#4-how-it-works-architecture--data-flow)
5. [Provider & model registry (2026)](#5-provider--model-registry-2026)
6. [Citation adapters: per-engine extraction truth](#6-citation-adapters-per-engine-extraction-truth)
7. [Methodology honesty: grounded-only SoMV, volatility, no fabrication](#7-methodology-honesty-grounded-only-somv-volatility-no-fabrication)
8. [The 14-stage analytics pipeline, stage by stage](#8-the-14-stage-analytics-pipeline-stage-by-stage)
9. [Site auditor: technical SEO truth for AI surfacing](#9-site-auditor-technical-seo-truth-for-ai-surfacing)
10. [Agent readiness (done right): llms.txt, MCP/WebMCP, UCP, ACP](#10-agent-readiness-done-right-llmstxt-mcpwebmcp-ucp-acp)
11. [Third-party dominance, geo & temporal tracking](#11-third-party-dominance-geo--temporal-tracking)
11b. [Commerce truth + traffic join](#11b-commerce-truth--traffic-join-late-2026)
12. [Scheduler, volatility repeats & Slack alerts](#12-scheduler-volatility-repeats--slack-alerts)
13. [Configuration reference](#13-configuration-reference)
14. [Server & dashboard guide](#14-server--dashboard-guide)
15. [Cost engineering: the 24.5¢ math](#15-cost-engineering-the-245-math)
16. [Security model](#16-security-model)
17. [Testing, eval goldens & CI](#17-testing-eval-goldens--ci)
18. [Head-to-head: vs Profound / Scrunch / Peec / Goodie / budget tools](#18-head-to-head-vs-profound--scrunch--peec--goodie--budget-tools)
19. [Roadmap](#19-roadmap)
20. [Troubleshooting & FAQ](#20-troubleshooting--faq)
21. [Repository map](#21-repository-map)

---

## 1. Why this exists (the 2026 competitive reality)

AI search referral traffic converts at up to **11x** traditional search (Goodie, 31M-citation study). The
category tracking it is now worth $1B+:

| Incumbent | Price | Moat | Their blind spot you exploit |
|---|---|---|---|
| **Profound** ($96M Series C, $1B val, 700+ enterprise) | $99/mo starter → enterprise 9–10 engines | Enterprise trust: SOC2/SSO, agents action layer | Hides grounded-vs-memory; no open audit trail |
| **Scrunch** (Sitecore ~$225M, Jun 2026) | $250/mo Core | Coverage (7 engines) + site audits bundled | No CPR, no parity calibration, no graphs |
| **Peec AI** ($29.1M raised, ~$10M ARR, 2,500+ teams) | €70–€360/mo | Unlimited seats, daily tracking, multi-country | Monitoring-only; generates zero fixes |
| **Goodie** | $399/mo Explorer | Closed-loop research→revenue proof | Doesn't hand you publishable remediation assets |
| **Otterly $29 / HubSpot free / Semrush / Ahrefs / SE Ranking** | bottom-up | Cheap, instant | Shallow: no attribution split, no volatility, no provenance |

**This repo's winning position: "open, auditable, technical SEO truth."** The differentiators no open-source
competitor combines: **CPR** (multi-turn citation persistence) + **G_auth** graph authority scoring +
**API/UI parity calibration** + **tamper-evident provenance** + **grounded-only honesty** + **auto-generated
JSON-LD remediation assets**. Lean into trust; beat vendors by *showing what they hide* (ungrounded answers,
answer volatility, crawler-door misconfigurations).

![CMO dashboard](screenshots/cmo-dashboard.png)
![Pipeline stages](screenshots/pipeline-stages.png)

---

## 2. What you get: capability map

**Collect (Node orchestrator — 9 collection paths)**
- GPT-5.5 via **Responses API** (`web_search` tool, `tool_choice`, `allowed_domains`, full `sources[]`;
  `search_context_size` validated to `high|medium|low`, `tool_choice:none` on RAG-off twins),
  GPT-5 Search API via Chat Completions, Claude 4 Sonnet/Opus (`web_search_20260209` + `user_location`,
  20250305 fallback), Gemini 2.5 Pro / 3 Flash via **`@google/genai`** (legacy SDK fallback; grounding +
  **Google-redirect resolution** with GET-Range fallback + bounded concurrency), Perplexity Sonar Pro
  (authoritative flat `citations[]`, honors `search_enabled`), DeepSeek V3 (memory baseline),
  **Grok 4** (xAI, self-reported search cost preserved **and billed**), **Copilot + Google AI Overviews +
  AI Mode via SERP API** (Serper / DataForSEO / Zenserp — AI Mode is a separately-instantiated surface,
  geo-aware `location_code`s), Playwright web-UI (opt-in parity control group), and a keyless
  **Demo provider**.
- Dual-query **attribution split** (RAG-on vs memory-baseline twins), volatility repeat engine
  (money prompts × 5, unseeded so variance is real), **fan-out harness** (`utils/fanout.js`: rule-based
  subquery decomposition labelled `local_decomposition` + BM25-lite passage reranker — joined with
  provider-reported fan-out, never disguised as engine telemetry), **real multi-turn chaining**
  (assistant history from this run, not empty previews), cost-flat **multi-country matrix**,
  `max_calls_per_run: 2500` fan-out guard with pre-flight cost estimate, token-level cost tracking with
  hard $500/day budget enforcement, rate limiting per provider, retry-with-backoff, live citation HTTP
  verification (2xx–3xx only, fail-closed when required), and per-result **provenance records** hashed
  into an immutable run manifest + append-only audit log (PII-redacted, hash-only mode available).

**Analyze (Python — 14 stages, zero fabricated values)**
1. Attribution classification (RAG vs base) · 2. Semantic triple extraction (passage-level) ·
3. Ground-truth claim verification (length-guarded containment) · 4. Four citation graphs with
dynamic edge floor (small datasets stay non-empty) · 5. **SoMV + grounded-only SoMV** (verdict+rank
primary rule, Wilson CIs on every rate, two-tier browse flags) · 6. Embeddings (MiniLM default, lazy) ·
7. Sentiment & hallucination matrix (response-prevalence Wilson CIs) · 8. Enterprise (parity,
**per-turn CPR**, **G_auth = 0.4·C_D + 0.35·C_B + 0.25·S_cons**, 3-door robots, computed-exposure ROI,
working remediation drafts, funnel trendlines) · 9. **Site audit** (cached, parallel) ·
10. **Agent readiness** (JSON-validated MCP manifests) · 11. **Volatility** (Wilson CIs) ·
12. **Third-party/geo-temporal + Commerce truth + Traffic join** (product-card tracking, Merchant Center
feed validation, ACP/UCP/Rufus checks, GSC generative-inclusion gate, GA4 AI-referrer revenue join) ·
13. Dashboard (10 charts, offline Plotly bundle, searchable recommendations) ·
14. Recommendations (computed exposure, no invented dollars).

**Act**
- Publishable **FAQ/Product/Article JSON-LD + Markdown** remediation drafts per negative/contradicted claim,
  authority-outreach briefs per missing source, site-audit fix lists, refresh cadences, scheduler + Slack
  alerts (SoMV drop >15%, competitor surge, hallucination spike, CPR collapse).

![Report sections](screenshots/report-sections.png)
![Usage flow](screenshots/usage-flow.png)

---

## 3. Quickstart (3 paths: demo, real, docker)

### Path A — Keyless demo (2 minutes, $0)

```bash
git clone https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator.git
cd AEO-LLM-Citation-Graph-Simulator
npm install
pip install -r requirements-lite.txt
python -m spacy download en_core_web_sm
npm run demo
# → seeds data/output/run_demo (168 rows, 7 models, 3 personas, RAG twins)
# → runs all 14 stages → data/output/analysis_*/dashboard/aeo_dashboard.html + 30+ recommendations
```

Or exercise the live orchestrator code with zero keys (synthetic provider, seeded brand):
```bash
AEO_DEMO_MODE=1 node src/node-orchestrator/index.js --demo --prompts 12
```

### Path B — Real tracking (live APIs)

```bash
cp .env.example .env   # add ≥1 key: OPENAI / ANTHROPIC / GOOGLE_AI / PERPLEXITY / DEEPSEEK / XAI / SERP
# 1. Tell it who you are:
#    config/entity_maps.json → your_brand (name, website, category, features, certs, USPs) + competitors[]
# 2. Tune cadence/cost:
#    config/execution.json   → prompt_count, mode (default api_only), volatility.repeats, geo.countries
# 3. Run:
npm run full-run
#    = node src/node-orchestrator/index.js --mode orchestrate
#      && python src/python-engine/main.py
node server.js   # dashboard at http://localhost:3000
```

### Path C — Docker

```bash
docker compose up        # node:22 + python3 + en_core_web_sm pre-baked, ./data + ./logs mounted
# docker includes requirements-lite; mount a .env with keys for real runs
# image runs as non-root `node`, ships HEALTHCHECK /api/health, and never bakes .env (.dockerignore)
```

### Path D — Render.com (Blueprint)

**Live instance: https://aeo-llm-citation-graph-simulator-1.onrender.com/**

`render.yaml` is included: New → Blueprint → point at the repo. Notes from real deploy logs:

- The container **must** bind `0.0.0.0:$PORT` — the image sets `HOST=0.0.0.0` and the server reads
  Render's injected `PORT`. (Binding loopback is why deploys fail with *"No open ports detected"*.)
- Health check is `/api/health` (no auth required; all other `/api/*` routes use `AEO_AUTH_TOKEN`,
  which the blueprint auto-generates — copy it from the dashboard into your client).
- The `pip install` download lines (`yarl`, `contourpy`, …) are normal build output, not errors.
- `spacy` ships in `requirements-lite.txt`, so `en_core_web_sm` pre-bakes into the image; embeddings
  and transformer sentiment intentionally use the **offline fallbacks** (MiniLM/keyword) on PaaS —
  full torch/transformers needs the heavy `requirements.txt` and a paid instance (RAM/disk).
- Add provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SERP_API_KEY`, …) as Render env vars —
  never commit them.

**Requirements:** Node ≥22, Python 3.11 (3.9+ works), ~200MB for lite install (no torch/transformers/UMAP/HDBSCAN;
Windows-safe). Full ML extras via `pip install -r requirements.txt` (lazy-loaded, opt-in). `npm install`
pulls the current SDKs (`openai@5`, `@anthropic-ai/sdk@0.40`, `@google/genai` + legacy fallback,
`playwright@1.49`, plus `vis-network`/`tom-select` replacing `lib/` vendored bundles).

---

## 4. How it works: architecture & data flow

```
┌─ config/ ─────────────────────────────────────────────┐
│ models.json (2026 registry + unverified candidates)   │  personas.json
│ execution.json (api_only, call-cap, privacy, geo,     │  entity_maps.json
│   volatility×5, scheduler, SERP)                      │
│ analytics.json (sm/MiniLM defaults, heavy opt-in)    │  schema.json + validator.js
└──────────────────────────────┬────────────────────────┘
                                ▼
┌─ src/node-orchestrator/ ────────────────────────────────────────────┐
│ promptGenerator (intent→answer-shape) → fanout.js (sub-queries +    │
│   rerank) → execution plan: models × turns × {RAG twins} × vol      │
│   (capped by max_calls_per_run, cost-flat across geo.countries)     │
│ providers/ openai anthropic google perplexity deepseek grok serp    │
│   (+ai-mode) demo (+ playwrightScraper opt-in parity group)         │
│ responseExtractor (adapters, sources-vs-inline, grounded FACT)      │
│ responseVerifier (quality gates + 2xx–3xx checks, fail-closed opt)  │
│ costTracker (per-run ledger, Grok search_cost + SERP $, hard $500)  │
│ rateLimiter  provenance (hash+manifest, PII redact / hash-only)     │
└──────────────────────────────┬──────────────────────────────────────┘
                                ▼  data/output/run_*/extracted_data/all_results.json
┌─ src/python-engine/main.py — 14 stages ─────────────────────────────┐
│ attribution → triples → verification → graphs → SoMV(+grounded) →   │
│ embeddings → sentiment → enterprise → site_audit → agent_readiness → │
│ volatility → third_party/geo + commerce + traffic_join →            │
│ dashboard → recommendations                                         │
└──────────────────────────────┬──────────────────────────────────────┘
                                ▼  data/output/analysis_*/ (reports/*.json + dashboard/*.html)
                 server.js / dashboard · /api/export · src/mcp-server.js
```

**Key files (orchestrator):** `src/node-orchestrator/index.js` (run lifecycle, capped volatility plan
builder, geo matrix, history chaining, budget enforcement, manifest writer), `providers/*.js` (7 real +
SERP incl. AI Mode + demo), `utils/fanout.js` (subquery decomposition + passage rerank),
`utils/responseExtractor.js` (adapters + grounded detection), `utils/promptGenerator.js`
(personas × funnel stages), `utils/costTracker.js`, `utils/rateLimiter.js`, `utils/responseVerifier.js`,
`utils/provenance.js` (SHA-256 manifest, JSONL audit, `redactPII`/`privacyFlags`),
`scheduler.js` (daily cycle + alert diffing).
**Key files (analytics):** `pipeline/attribution_split.py`, `pipeline/triple_extractor.py`,
`pipeline/verification.py`, `analytics/citation_graph.py`, `analytics/share_of_voice.py` (grounded-only),
`analytics/embedding_analyzer.py`, `analytics/sentiment_matrix.py`, `analytics/enterprise_insights.py`
(parity, per-turn CPR, G_auth, 3-door robots, computed-exposure ROI, remediation, trendlines),
`analytics/site_auditor.py`, `analytics/agent_readiness.py`, `analytics/volatility.py`,
`analytics/third_party_geo.py`, **`analytics/commerce.py`** (product cards, feed health, ACP/UCP/Rufus),
**`analytics/traffic_join.py`** (GSC gate + GA4 referrer join),
`dashboard/generate.py` (grounding banner + 10 Plotly charts, offline bundle, rec search).

---

## 5. Provider & model registry (2026)

`config/models.json` v2026.09. Legacy 2024 IDs (`gpt-4o-search-preview`, `claude-3-opus`, `gemini-1.5-pro`,
`web_search_preview` tool — shut down **2026-07-23**) live under `deprecated` with `migrate_to` pointers; the
orchestrator refuses to schedule them **and CI fails any PR that references them**. Late-2026 candidates
(Gemini 3.x, Claude 4.6–4.8, Grok 4.1/5, GPT-5.6, Perplexity Agent API) live under `late_2026_candidates`
with `scheduled:false` + `registry_status:unverified` — verify each `model_id` against provider docs before
enabling; estimated costs are placeholders, never billed math.

| Provider file | Model(s) | API shape | Browsing | Avg cost/answer¹ | Cites/answer¹ | Index bias¹ |
|---|---|---|---|---|---|---|
| `openai.js` | GPT-5.5 (Responses) / GPT-5 Search API | `POST /v1/responses` + `tools:[{type:web_search}]`, `tool_choice`, `allowed_domains`, `return_sources` | 74% even when asked | 3.5¢ | 7.92 | Bing; Wikipedia 16.3% |
| `anthropic.js` | Claude 4 Sonnet / 4 Opus | Messages + `web_search_20260209` (max_uses 5, `user_location`, 20250305 fallback) | tool-driven | 10.1¢ (most expensive) | 5.67 | Brave; NYT/Atlantic/NPR; longest freshness |
| `google.js` | Gemini 2.5 Pro / 3 Flash | `@google/genai` (legacy fallback) + `googleSearch` grounding | always (redirects!) | 0.2¢ | ~13.3 | Google; Wiki 11.2%, YouTube 9.5%, Google-owned 22.8% |
| `perplexity.js` | Sonar Pro | chat completions, always-search | always (flags contaminated baselines) | ~2¢ | 21.87 | Reddit 6.6%; 82% Google overlap |
| `deepseek.js` | DeepSeek V3 | chat completions | **never (memory baseline)** | 0.2¢ | 0 | n/a — RAG-vs-base anchor |
| `grok.js` | Grok 4 (xAI) | OpenAI-compatible + `web_search` | tool-driven | 3.5¢ (+ billed search_cost) | — | reports own `search_cost` (preserved **and costed**) |
| `serp.js` | Copilot / AI Overviews / **AI Mode (separate provider)** | SERP API (Serper/DataForSEO/Zenserp, geo `location_code`s) | SERP-grounded | ~0.5¢ (tracked) | SERP refs | AIO↔AI-Mode share ~13.7%; fan-out queries captured |
| `demo.js` | synthetic | keyless | simulated | $0 | 3/0 | clearly labelled `demo_synthetic`, quarantined from prod |

¹ Stork.AI prod measurement, Aug 2026, 925 runs. **1 question × 6 engines ≈ $0.245.** Families and surfaces are
kept split everywhere (`by_model`, `by_model_family`, `serp_surface`) — averaging engines into one SoMV is
methodologically dishonest and this tool refuses to do it silently.

Per-model knobs passed at call time: `tool_choice: auto|required|none` (`none` forced on RAG-off twins),
`allowed_domains[]`, `search_context_size: high|medium|low` (`128k` is rejected — it 400s),
`resolve_redirects` (Gemini, default on), `geo` (all providers + SERP surfaces).

---

## 6. Citation adapters: per-engine extraction truth

`utils/responseExtractor.js` implements four adapters (plus SERP/Grok/Demo), each with recorded unit fixtures
in `utils/unitTests.js` — formats change monthly, fixtures catch drift:

- **OpenAI Responses** — `output[].content[].annotations[]` (`type == url_citation`) = inline/claim-anchored;
  top-level `sources[]` = full bibliography. Tool-call items (`web_search_call`) become `hidden_search_queries`.
  `search_performed` = annotations/sources/queries non-empty (FACT, not the request flag).
- **Anthropic** — `content[]` blocks with `type == web_search_tool_result` → `content[].url` + title; all URLs
  stripped of `?utm_*` + fragments so domain attribution is clean. Legacy text-block `citations` kept as fallback.
- **Gemini** — `candidates[0].groundingMetadata.groundingChunks[].web.uri` are **Google redirects**; each is
  followed with `HEAD` then a `GET Range:0-0` fallback (8s timeout; HEAD alone 405s/WAFs into false
  `resolved:false`), deduped and resolved through a bounded (5-slot) pool. Publisher URL stored in `url`
  with `raw_uri` + `resolved:true`. Unresolved redirects are counted (`google_redirects_unresolved`) and
  excluded from grounded-only SoMV. `webSearchQueries` preserved as `fanout_queries`.
- **Perplexity** — flat `citations[]` is authoritative; inline `[n]` markers map to `citations[n-1]`; bare-URL
  regex is fallback only (flagged `fallback:true`, confidence 0.6). `search_requested` honors the RAG flag —
  and because Sonar always retrieves server-side, a RAG-off twin that still returns citations is flagged
  `search_contaminated_baseline` so SoMV can exclude it.
- **Output split**: `citations[]` (deduped all) vs `sources[]` (bibliography) vs `inline_citations[]`
  (claim-anchored). Entity extraction covers brand + aliases + features + authority domains with positions;
  Node sentiment is an explicitly-labelled `regex_baseline` (deep transformer sentiment runs in Python).

---

## 7. Methodology honesty: grounded-only SoMV, volatility, no fabrication

**The 74% problem.** Stork measured ChatGPT API browsing only ~74% of calls even when instructed. Every other
vendor hides this. This tool records `search_requested` (intent) vs `search_performed` (evidence: citations,
hidden queries, grounding metadata) per response, then:

- `somv.grounded_only` — full SoMV recomputed on browse-evidenced rows only, with `browse_rate_by_model`
  (two-tier honesty: `LOW_BROWSE_RATE` <50% on ≥5 rows, `BELOW_BENCHMARK_74` below the Stork benchmark) and a
  `grounded_share < 74%` warning. Primary-recommendation uses a **verdict + rank-position rule** (verdict-zone
  presence AND named at/before any competitor) — the old first-sentence heuristic inflated leadership.
  Every rate ships a **Wilson 95% CI** (`mention_rate_ci95`, `primary_…_ci95`, `omission_rate_ci95`); n<30 is
  labelled, never hidden;
- `somv.grounding_diagnostics` — requested-vs-performed skip rate with `variance_flag` (>20% skip);
- `data_quality` — `grounded_responses / ungrounded_responses / grounded_share` + an explicit warning when
  memory answers exceed 26%;
- **Dashboard** — a methodology banner (red when grounded <74%) plus a *Browse Evidence Rate by Model* chart;
  recommendations downgrade ungrounded SoMV to "pre-training popularity" and force the grounded toggle for decisions.

**Volatility.** `execution.volatility: {enabled, repeats: 5}` repeats money prompts
(`comparison_analysis`, `pricing_procurement`, turn 0). `analytics/volatility.py` reports per-prompt
instability (leader-flip rate), per-brand win rates with **Wilson 95% CIs**, and an `unstable_share` gate
(>30% → "point-estimate SoMV is theater" HIGH alert). No repeats → explicit `no_repeats` status telling you
to enable it, because AIO shifts ~70% on repeat.

**No fabrication, ever.** A prior version injected *"X is a leading provider…"* when a summary row claimed a
mention without response text — poisoning SoMV, triples, and embeddings. Removed. Such rows are now
`success:false` + `unusable_reason: claimed_brand_mention_without_response_text`. Guarded by eval goldens.

---

## 8. The 14-stage analytics pipeline, stage by stage

`python src/python-engine/main.py [--run-dir …] [--config …]` · progress lines (`__PROGRESS__`) stream to
`server.js` for the live stage bar · every stage writes `reports/*.json` · failures degrade to
`{status:error}` without killing the run.

| # | Stage (module) | What it computes (all from your real rows) |
|---|---|---|
| 0 | Data quality (`main.build_data_quality_report`) | record/citation/brand/model/channel coverage, declared-vs-actual prompt counts, grounded split, `coverage_score`, honest `warnings[]` |
| 1 | Attribution (`pipeline/attribution_split.py`) | RAG-vs-base classification per response + stats |
| 2 | Triples (`pipeline/triple_extractor.py`) | spaCy S–P–O claims, negation-aware, passage-level merging, dedup stats, per-brand +/- splits |
| 3 | Verification (`pipeline/verification.py`) | claims vs your ground-truth corpus (uploads + entity attributes): verified/partial/unverified/**contradicted** + per-model veracity; containment similarity has a length guard so 2-token ground truth ("SOC 2") can't verify long claims |
| 4 | Graphs (`analytics/citation_graph.py`) | **4 graphs** (citation, co-occurrence, entity-citation, model-comparison); in/out-degree, betweenness, PageRank, eigenvector, Katz; Louvain communities; `missing_authority_nodes`, competitor-dominant sources; **dynamic edge floor** (`max(2, N/50)`, weight-1 kept when N<20) so small datasets aren't wiped |
| 5 | SoMV (`analytics/share_of_voice.py`) | overall/by-model/by-persona/by-turn/turn-index, RAG-vs-base attribution insights, omissions, citation depth, competitive gaps, **grounded-only + diagnostics**, Wilson CIs |
| 6 | Embeddings (`analytics/embedding_analyzer.py`) | MiniLM (lazy; mpnet opt-in), semantic drift, brand intra-sim (<0.6 inconsistency alert), cross-model sim (<0.85 flag), UMAP/HDBSCAN optional with sklearn fallback |
| 7 | Sentiment (`analytics/sentiment_matrix.py`) | RoBERTa (heavy opt-in; VADER/regex baseline default), bias patterns with severity + **response-prevalence Wilson CIs**, hallucination signals, negative clusters |
| 8 | Enterprise (`analytics/enterprise_insights.py`) | parity calibration (>15% variance flag), **per-turn CPR** (mean persist, empty-prev counted not skipped), **G_auth = 0.4·C_D + 0.35·C_B + 0.25·S_cons** (message-consistency, weights justified) with brand rank, 3-door robots, source ROI influence weights, **computed-exposure ROI** (no invented dollars), working JSON-LD/outreach remediation drafts (full-context wired), family × funnel trendlines |
| 9 | **Site audit** (`analytics/site_auditor.py`) | §9 (cached + parallel fetches) |
| 10 | **Agent readiness** (`analytics/agent_readiness.py`) | §10 (JSON-validated MCP manifests) |
| 11 | **Volatility** (`analytics/volatility.py`) | §7 |
| 12 | **Third-party/geo + Commerce + Traffic** (`third_party_geo.py`, **`commerce.py`**, **`traffic_join.py`**) | §11 + product-card tracking, Merchant Center feed validation, ACP/UCP/Rufus checks, GSC inclusion gate, GA4 AI-referrer join |
| 13 | Dashboard (`dashboard/generate.py`) | **10 Plotly charts** (adds CPR, G_auth, volatility-with-CI) + dark enterprise HTML, grounding banner, **offline Plotly bundle** (inlined, zero-CDN), **searchable all-recommendations**, commerce + traffic sections, JSON data export (UTF-8) |
| 14 | Recommendations (`main.generate_recommendations`) | every module → `{priority, category, finding, action, estimated_impact, computed_exposure}` sorted HIGH→INFO (demo run: 33, exposure = omission_gap × grounded base) |

Cross-module synthesis fires compound alerts (negative-claims × HIGH-biases; missing-nodes × omission rate).

---

## 9. Site auditor: technical SEO truth for AI surfacing

Google's May 15 2026 AI Optimization Guide is explicit: AI Overviews / AI Mode need **indexed +
snippet-eligible** pages (core ranking + RAG + query fan-out) — no special markup, no `llms.txt`, no chunking,
no LLM-rewriting. `analytics/site_auditor.py` fetches `your_brand.website` (+`/pricing`, `/faq`, `/about`)
and scores 0–100 (A/B/C/F) across six weighted checks:

1. **Snippet eligibility (25%)** — `nosnippet` / `max-snippet:0` / `data-nosnippet` grep. Google applies these
   to AI features too: a blocked page *cannot* surface. Score 0 if any found, with removal fix.
2. **JS-render risk (20%)** — app-shell heuristics + static word count. Crawlers parse static HTML at ~94%
   vs ~23% for JS shells: server-render answer-first blocks (what `curl` returns is what crawlers get).
3. **Semantic HTML (20%)** — question-H2s, 20–40-word direct answers in the first 2 lines, semantic
   tables/lists, 40–60-word quotable definitions.
4. **JSON-LD validity (20%)** — Organization `@id`+`sameAs`, FAQPage (40–60w answers), Product/Offer (+GTIN),
   Article author+`dateModified`, LocalBusiness/GBP match; unparseable blocks flagged.
5. **Freshness (10%)** — `dateModified` presence + age vs engine windows (ChatGPT/Perplexity ~30d,
   Claude ~quarter, AIO ~year) → per-family refresh cadence.
6. **E-E-A-T (5%)** — author bylines, About/Contact, original data/methodology, Merchant Center + GBP.

---

## 10. Agent readiness (done right): llms.txt, MCP/WebMCP, UCP, ACP

`analytics/agent_readiness.py` scores 0–100 (Agent-ready ≥75) with explicit caveats, because the industry
currently oversells `llms.txt`:

- **`llms.txt` (15% weight, experimental)** — presence, Markdown structure, length, canonical links. Labelled
  *"agents-only convenience; NOT a Google ranking factor (Illyes/Mueller)."* Never sold as SEO.
- **MCP / WebMCP Tool Contract (35%)** — probes `/.well-known/mcp.json`, `/mcp.json`, `/api/mcp`,
  `/api/ucp/mcp` in parallel (cached) for tool contracts; substring hits are smoke signals only —
  `json_validated[]` lists endpoints returning a parseable tool manifest.
- **ACP (25%)** — Agentic Commerce Protocol signals for ChatGPT Shopping checkout.
- **Machine basics (25%)** — robots.txt, sitemap.xml, JSON-LD presence.
- Includes Shopify **UCP `search_catalog`** detection and an isitagentready-style checklist. The standing
  recommendation: ship MCP/UCP/ACP *before* polishing `llms.txt`.

---

## 11. Third-party dominance, geo & temporal tracking

**80–90% of LLM answers come from earned media; 57% of branded cites from reviews/social.**
`analytics/third_party_geo.py`:

- **Vertical packs** — Reddit, YouTube, reviews (G2/Capterra/Trustpilot/TrustRadius), press, analyst
  (Gartner/Forrester/IDC), docs (GitHub/StackOverflow) with **per-engine weights** (Claude 2–4x UGC/reviews,
  Gemini YouTube + brand-official weight, Perplexity Reddit 1.6x), earned-vs-owned split, concentration
  alerts, and generated **platform-specific outreach briefs** per pack (WHY this engine over-weights it +
  ACTION: YouTube chapters/transcripts for Gemini, earned subreddit answers for Perplexity, review-generation
  program for Claude, data-study pitches for analyst/press).
- **Geo** — multi-country replication matrix (the Peec Advanced differentiator): prompt budget is **split**
  cost-flat across `execution.geo.countries` (not multiplied), every row tagged `geo`, EU-vs-US leader split
  in geo-temporal, with GBP + LocalBusiness-per-locale checklist.

## 11b. Commerce truth + traffic join (late 2026)

`analytics/commerce.py` — because ~83% of ChatGPT shopping carousels resolve to feed-backed listings:

- **Product-card tracking** — price/buy-signal presence per model in your collected rows (card rate + honest finding);
- **Merchant Center feed validation** — drop XML/CSV/TSV/JSON into `data/uploads/commerce/`; missing
  `id/title/link/price/availability/image_link` shares reported with carousel-filter impact;
- **ACP** (`agenticcommerce.dev` `/agentic-checkout` + `checkout_eligibility`), **UCP** (`ucp.dev`
  `/api/ucp/mcp` `search_catalog` validity → `native_commerce`), **Rufus** (Product + reviews + offers score).

`analytics/traffic_join.py` — SoMV without traffic can't claim revenue. Drop a **GSC export**
(`query, clicks, impressions, ai_overview_present`) and **GA4 export** (`source, sessions, conversions,
revenue`; tag with `utm_source=chatgpt.com`) into `data/uploads/traffic/` for the generative-inclusion
gate + AI-referrer revenue shares. No files → explicit `no_data` with the exact expected schema. Never
invented.
- **Temporal** — per-family freshness windows + recommended refresh cadence (weekly ≤30d, monthly ≤90d,
  quarterly otherwise).

---

## 12. Scheduler, volatility repeats & Slack alerts

```bash
node src/node-orchestrator/scheduler.js --daily          # orchestrate → analyze → alerts (cron: 0 6 * * *)
node src/node-orchestrator/scheduler.js --check-alerts   # diff latest analysis vs previous
```

Alert rules (`execution.scheduler.alerts`, webhook via `SLACK_WEBHOOK_URL`): **SoMV drop >15%**,
**competitor surge >15%**, hallucination spike, new-negative-triple signal, CPR <50%. Volatility repeats are
orthogonal (collection-time, §7); the scheduler is tracking-time. Prompt intelligence supports both:
intent→answer-shape templates (shortlist/definition/steps/verdict), query fan-out
(`src/node-orchestrator/utils/fanout.js`: `fanoutSubqueries()` decomposition + `rerankPassages()`
BM25-lite scorer, attached to every result with `local_decomposition` vs `provider_reported` origins),
and objection/compliance depth for Reddit-style queries. Entry guards are Windows-safe (`pathToFileURL`).

---

## 13. Configuration reference

| File | Owns | 2026 notes |
|---|---|---|
| `config/models.json` | provider/model registry, costs, adapters, `deprecated` + `late_2026_candidates` blocks, Stork reference table | never re-add `web_search_preview` (validator fails CI); verify candidate IDs before `scheduled:true` |
| `config/execution.json` | `mode` (**`api_only` default**; hybrid = 15% Playwright opt-in), `max_calls_per_run` (2500 fan-out guard), `deterministic` (seed only when true + volatility off), `privacy` (redact/hash-only), `search_options` (incl. `high\|medium\|low`), `volatility` (×5), `geo.countries` (cost-flat split), `scheduler`, `serp`, budgets, retries, per-surface rate limits (incl. `serp/microsoft/google-serp/ai-mode`) | Playwright carries ToS risk — use as 20% parity control only |
| `config/analytics.json` | `en_core_web_sm` + MiniLM defaults; heavy (`trf`, RoBERTa, UMAP/HDBSCAN) opt-in; `site_audit.extra_pages`; dashboard `grounded_toggle_default` | `output.formats` is json/csv/html (PDF removed — had no generator) |
| `config/personas.json` | technical/business/procurement buyers × 5 funnel turn-templates | placeholders resolve from entity maps + safe defaults |
| `config/entity_maps.json` | **your_brand** (name, aliases, website, category, features, pricing, certs, USPs, ground-truth URLs) + competitors[] + authority sources[] | empty → FATAL (or demo-seeded in `--demo`) |
| `config/schema.json` + `validator.js` | fail-fast validation (models incl. retired-ID CI fail + context-size enum, entities, execution incl. call-cap/geo, personas, keys incl. XAI/SERP, demo bypass) | run `node config/validator.js` pre-flight |
| `.env` (from `.env.example`) | 7 provider keys + `SERP_PROVIDER/GEO` + `AEO_AUTH_TOKEN` + `AEO_CORS_ORIGIN` + `SLACK_WEBHOOK_URL` + `AEO_ALLOW_SYNTHETIC` (demo only) + heavy-model opt-ins | never committed (gitignored) |

---

## 14. Server & dashboard guide

`node server.js` → `http://localhost:3000` (loopback `127.0.0.1`; production **refuses to boot**
without `AEO_AUTH_TOKEN`, token compared in constant time, CORS pinned via `AEO_CORS_ORIGIN`).

- **Endpoints**: `GET /` (dashboard) · `POST /api/upload/:section` (allow-listed sections, sanitized names)
  · `GET /api/uploads` · `GET/POST /api/config` (2MB cap, shape-validated) ·
  `DELETE /api/upload/:section/:filename` (traversal-proof) · `POST /api/analyze` (no-shell spawn,
  14-stage progress streaming) · `GET /api/status?id=` · `GET /api/results?include=summary|html|full&limit=N`
  (paginated, slim-projected — multi-MB dashboard HTML is never shipped unasked) · `GET /api/runs` ·
  **`GET /api/export?format=json|csv`** (flat SoMV CSV for Looker Studio/Sheets) · `GET /api/health` (unauthenticated probe).
- **Dashboard** (`dashboard/generate.py`): grounding banner, 10 charts (SoMV, grounded-vs-memory, omission,
  sentiment, turn evolution, citation depth, claim verification, **CPR, G_auth, volatility-with-CI**),
  SoMV table, **all recommendations with live search**, bias cards, verification ledger, commerce + traffic
  sections. Static assets allow-listed (`/screenshots/`, `/src/dashboard/` only). Vendored `lib/`
  (vis, tom-select) is deprecated in favour of the npm packages — kept only as offline fallback.
- **MCP server** (`src/mcp-server.js`, stdio, read-only): `latest_summary | brand_sov | verification |
  commerce | traffic` tools for Claude/agents. Never expose over TCP without a token.
- **Upload flow**: drop `results` JSON (orchestrator output or vendor exports — wide schema tolerated:
  `prompts/results/data/records/responses` unwrapped, `model_response/answer/content` mapped) and/or
  `corpus` gold standards + `system_config`, then Analyze. Commerce feeds → `data/uploads/commerce/`;
  GSC/GA4 exports → `data/uploads/traffic/`.

---

## 15. Cost engineering: the 24.5¢ math

`utils/costTracker.js` prices every call from registry rates, warns at 80% of the **$500/day budget (hard
stop — `BudgetExceededError`, exit 3)**. The ledger **resets per runId** (a stale `cost_session.json` can no
longer false-trip the budget on run #2) and now bills what it used to ignore: **Grok's self-reported
`search_cost`** and **$0.005/SERP call**. Reference reality (Stork, 925 prod runs): ChatGPT 3.5¢,
Claude 10.1¢, Gemini 0.2¢, Perplexity ~2¢, Grok 3.5¢, DeepSeek 0.2¢, scraper UI 0.4¢. **Vendor pricing is
dashboard margin, not data cost** — Scraper UI is 16x cheaper but burns accounts; hence `api_only` default
with Playwright as a calibration control. `getReport()` yields per-model/provider/persona spend,
cost-per-query, trend direction, and 5k-query projections. Reports surface estimated pipeline ranges so
finance sees the bill before it lands.

---

## 16. Security model

- Server binds **loopback only**; `Bearer` token gates all `/api/*` — **production refuses to start
  without `AEO_AUTH_TOKEN`** (fail-loud, constant-time compare); per-IP 60-req/min limiter with **bounded
  memory** (stale-IP sweeps + oldest eviction past 5k IPs); security headers (`nosniff`, `DENY`, `no-referrer`);
  CORS pinned by `AEO_CORS_ORIGIN` (no more unconditional `*` in prod).
- **25MB** body cap (was 500MB); multipart boundary/limits hardened; filenames `basename`+sanitized with
  `startsWith` containment assertions; DELETE requires exact `:section/:filename` with `..`/separator rejection.
- Python spawned **without shell** (argv array — no command injection via paths); static serving is an
  allow-list (the old server served *any file under the repo root* — fixed).
- **Privacy**: `execution.privacy.redact_pii` (default on) scrubs emails/secrets from persisted raw copies;
  `hash_only_raw` stores content-hash + 500-char redacted preview instead of plaintext. No PII at rest option.
- `.env`, `data/output|uploads|sessions`, `logs/` gitignored (+ `.dockerignore` keeps secrets out of the
  image); provenance manifest (SHA-256 per result + config hash) + JSONL audit trail give tamper evidence
  Profound charges enterprise tiers for. Container runs as non-root `USER node` with `HEALTHCHECK /api/health`.

---

## 17. Testing, eval goldens & CI

```bash
npm test
# node --test unitTests.js (18: provenance, verifier incl. fail-closed gate, validator, adapter fixtures)
# python test_verification.py + test_eval_goldens.py (12: no-fabrication, grounded math,
#   3-door model, Wilson bounds, G_auth regression, registry freshness, api_only default, lite-import guard)
# testRunner.js + test_pipeline.py (integration)
```

- **`.github/workflows/ci.yml`**: Node 22 + Python 3.11 jobs; installs **lite** deps; runs unit tests +
  eval goldens, then seeds + runs the full demo pipeline with `AEO_ALLOW_SYNTHETIC=1` (the strongest CI
  signal: the product proving itself). `testRunner.js` / `test_pipeline.py` are local readiness gates
  (they demand your real `.env` + brand config), so they run via `npm test` on your machine, not in CI.
- Every P0 fix in v2.1 was proven before merge: full 14/14-stage demo pipeline green, 24/24-task
  orchestrator demo run (geo + fanout + provenance on every row), plus targeted assertions for the
  semantic-remediation wiring, per-turn CPR math, SoV primary rule, lexical guard, graph floor,
  context-size enum, cost ledger reset, and validator gates.
- **`src/python-engine/tests/test_eval_goldens.py`** guards methodology invariants so future edits can't
  silently reintroduce fabrication, averaged-engine SoMV, single-door robots logic, or the G_auth shadowing bug.

---

## 18. Head-to-head: vs Profound / Scrunch / Peec / Goodie / budget tools

| Capability | This repo (v2.1, open) | Profound $99–399+ | Scrunch $250 | Peec €70–360 | Goodie $399 | Otterly $29 / HubSpot free |
|---|---|---|---|---|---|---|
| Live 2026 model APIs (GPT-5.5, Claude 4, Gemini 2.5/3, Grok) | ✅ | ✅ (9–10 engines) | ✅ (7) | ✅ (6) | ✅ | partial |
| AIO / AI Mode / Copilot SERP surfaces | ✅ (SERP API, AI Mode separate) | ✅ | partial | ❌ | partial | ❌ |
| Grounded-vs-memory honesty | ✅ **flagship** (Wilson CIs, 2-tier flags) | ❌ hidden | ❌ | ❌ | ❌ | ❌ |
| Answer volatility + CIs | ✅ (×5, Wilson everywhere) | ❌ | ❌ | ❌ | ❌ | ❌ |
| CPR (multi-turn persistence) | ✅ (per-turn, unbiased) | ❌ | ❌ | ❌ | ❌ | ❌ |
| G_auth graph authority | ✅ (S_cons, justified weights) | ❌ | ❌ | ❌ | ❌ | ❌ |
| API/UI parity calibration | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 3-door robots audit | ✅ | ❌ | partial (site audit) | ❌ | ❌ | ❌ |
| Site audit (snippet/JS/JSON-LD/freshness) | ✅ (cached, parallel) | ❌ | ✅ | ❌ | partial | partial |
| Publishable JSON-LD fixes | ✅ (auto-drafted, wired) | ❌ | ✅ | ❌ | partial | ❌ |
| Agentic commerce (ACP/UCP/Rufus + feeds) | ✅ | partial | ❌ | ❌ | partial | ❌ |
| Provenance manifest + audit trail | ✅ (+ PII-safe modes) | ✅ (SOC2/SSO) | ❌ | ❌ | ❌ | ❌ |
| Scheduler + Slack alerts | ✅ | ✅ | ✅ | ✅ (daily) | ✅ | ✅ |
| Multi-country + GBP | ✅ (cost-flat matrix + checklist) | ✅ | partial | ✅ (Advanced) | partial | ❌ |
| MCP server + API/CSV export | ✅ (read-only, Looker-ready) | ✅ | ❌ | partial | ❌ | ❌ |
| Revenue attribution | partial (GSC/GA4 join ships — needs your exports) | ✅ agents layer | partial | ❌ | ✅ **flagship** | ❌ |
| Seats/SSO/SOC2 | ❌ (their lead) | ✅ | ✅ | ✅ unlimited | ✅ | partial |

**Bottom line:** you win *"open, auditable, technical SEO truth"* — every claim a competitor makes with a
score, you make with evidence. Their durable leads (revenue proof, SSO/SOC2, seat velocity) are honestly
marked above, not hand-waved.

---

## 19. Roadmap

Done in v2.1 (moved off this list): GSC/GA4 ingest (needs only your exports), fan-out + reranker harness,
Merchant Center feed checks, `lib/` → npm packages (shipped, old bundles kept as offline fallback),
computed-exposure ROI, per-turn CPR, SoV Wilson CIs, AI Mode wiring, PII-safe provenance.

- [ ] PDF exporter (real generator — the formats list no longer lies)
- [ ] Playwright stealth refresh + residential-proxy rotation presets
- [ ] Multi-locale GBP scale-out (matrix ships; per-locale content packs don't)
- [ ] Revenue-join activation template (Goodie-style: citation share × traffic share scatter → pipeline —
  join ships, guided setup doesn't)
- [ ] SSO/SOC2 evidence pack + seat/role model (the honest enterprise gap, §18)
- [ ] Daily UX scrape preset in 115 languages (their velocity moat; API-first here)

---

## 20. Troubleshooting & FAQ

**"FATAL: No primary brand / No competitors"** → fill `config/entity_maps.json`, or run `npm run demo`.
**"FATAL: No valid API keys"** → copy `.env.example` → `.env`, or `AEO_DEMO_MODE=1`.
**"No citations found" warning always fires** → you were on the old build; v2 adapters + Gemini redirect
resolution + `always_search` Perplexity fixed the silent-zero path. Check `grounding_diagnostics.skip_rate`.
**Embeddings slow first run** → MiniLM downloads once (~40s), then cached; heavy models stay off unless opted in.
**UMAP spectral warnings on tiny corpora** → cosmetic (falls back to random init); grows away with real volumes.
**`Graph authority failed` warning** → fixed (brand-loop shadowing `b`); covered by `g-auth-regression` golden.
**Playwright login walls** → expected; web-UI is an opt-in parity control, not the collection path.
**Windows `pip install` explodes on torch** → that's why `requirements-lite.txt` is the default.
**Dashboard shows red grounding banner** → that's the product working: switch decisions to grounded-only SoMV.
**Pipeline refuses with "No analyzable records … quarantined"** → you're analyzing a synthetic-seeded dir
without the demo opt-in. Real `run_*` dirs are unaffected; demo analysis needs `AEO_ALLOW_SYNTHETIC=1`
(`python seed_demo_data.py --run` sets it automatically).
**Dashboard failed with `charmap … cp1252` before v2.1** → fixed: all writers are UTF-8 (the inlined offline
Plotly bundle is ~4–5MB and non-ASCII by nature).
**Cost doubled vs estimate / budget trips early** → pre-v2.1 under-billed Grok search + SERP calls; v2.1
bills both and resets the ledger per run. Re-baseline your first v2.1 run.

---

## 21. Repository map

```
├── config/                  models.json (registry + deprecated + unverified candidates) ·
│                            execution.json (api_only + call-cap + privacy + cost-flat geo + volatility + scheduler)
│                            analytics.json (lite defaults) · personas.json · entity_maps.json · validator.js
├── src/node-orchestrator/   index.js · providers/{openai,anthropic,google,perplexity,deepseek,grok,serp,demo}.js
│                            scrapers/playwrightScraper.js · scheduler.js
│                            utils/{promptGenerator,responseExtractor,costTracker,rateLimiter,
│                                   responseVerifier,provenance,fanout,testRunner,unitTests}.js
├── src/mcp-server.js        read-only stdio MCP audit surface (latest_summary/brand_sov/verification/commerce/traffic)
├── src/python-engine/       main.py (14 stages) · pipeline/{attribution_split,triple_extractor,verification}.py
│                            analytics/{citation_graph,share_of_voice,embedding_analyzer,sentiment_matrix,
│                                       enterprise_insights,site_auditor,agent_readiness,volatility,third_party_geo,
│                                       commerce,traffic_join}.py
│                            dashboard/generate.py · tests/{test_pipeline,test_verification,test_eval_goldens}.py
├── server.js                hardened loopback API (export, paginated results) + dashboard host
├── seed_demo_data.py        keyless labelled demo_synthetic corpus generator + pipeline runner
├── requirements-lite.txt / requirements.txt (full/heavy) · Dockerfile (node:22, non-root, HEALTHCHECK)
│                            .dockerignore · docker-compose.yml · render.yaml
├── lib/                     DEPRECATED vendored bundles (offline fallback; npm packages are canonical)
├── .github/workflows/ci.yml (Node 22 + AEO_ALLOW_SYNTHETIC demo gate) · .env.example · screenshots/ · setup.js / setup.ps1
└── data/output/ · data/uploads/{commerce,traffic,…} · logs/   (gitignored — evidence lives here, not in git)
```

*Built local-first. Verified with real runs. No score without a receipt.*
