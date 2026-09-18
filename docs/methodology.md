# Methodology — Grounded-Only Truth (Do Not Regress)

This document is the moat. Read before touching SoMV, adapters, CPR, provenance, or cost code.

## 1. Grounded-only SoMV (elite, keep)

- Split every row into `search_requested` vs `search_performed`. Recompute SoMV on
  **browse-evidenced rows only** (`search_performed=true` + ≥1 verified citation).
- Every rate ships with **Wilson 95% CIs** (`analytics/volatility.py::wilson`).
- Flags: `LOW_BROWSE_RATE` when browse rate <50%, `BELOW_BENCHMARK_74` when below the
  Stork.AI ChatGPT-browsing reference (~74% even when instructed).
- Ungrounded / memory-only rows are reported separately, never merged into grounded SoMV.
- Stork-style reference: 925 runs, 1 question × 6 engines ≈ $0.245 at API prices.
  Re-run `scripts/benchmark_pack.py` to refresh grounded rates per engine.

Implementation: `src/python-engine/analytics/share_of_voice.py`,
`src/python-engine/pipeline/attribution_split.py`, eval goldens in
`src/python-engine/tests/test_eval_goldens.py`.

## 2. Per-engine citation adapters (not one regex)

| Engine | Adapter | Notes |
|---|---|---|
| OpenAI | `openai_responses_annotations` (`annotations[]`, `sources[]`, `web_search_call`) | preserve search_context_size |
| Anthropic | `anthropic_web_search_tool_result` | strip UTM, `max_uses:5`, fallback `web_search_20250305` |
| Gemini | `gemini_grounding_chunks_resolve_redirect` | Google-redirect resolution via HEAD + GET Range fallback, 5-slot pool |
| Perplexity | `perplexity_citations_flat` (`citations[]`) | authoritative; flag `search_contaminated_baseline` when Sonar retrieves on a RAG-off twin |
| Grok | `openai_chat_annotations` | preserve `usage.search_cost`, bill it |
| SERP (AIO/AI Mode/Copilot) | `serp_aio_citations` / `serp_organic_results` | track fan-out queries, AIO+AI Mode share ~13.7% citations |

Format drift is caught by `src/node-orchestrator/utils/unitTests.js` fixtures.
If a provider changes payload shape, add a fixture first, then patch the adapter.
Never collapse adapters into a single regex.

## 3. No-fabrication rule

- If response text is missing, emit `success:false + unusable_reason`. Never inject
  "X is a leading provider…" placeholder copy (deleted 2026-08, guarded by eval goldens).
- Every analytics module returns `status:no_data + schema spec` when inputs are absent.
  No invented numbers, ever.
- GEO tactics (statistics, quotations, authoritative tone) are measured, not assumed.

## 4. CPR + G_auth + Parity

- **CPR (Citation Persistence Rate)**: multi-turn, per-turn. Empty-prev is counted, not skipped.
  `enterprise_insights.multi_turn_cpr.overall_cpr < 0.5` fires a Slack alert.
- **G_auth** = `0.4*C_D + 0.35*C_B + 0.25*S_cons` (domain authority, brand consistency, sentiment consistency).
- **API/UI parity**: Playwright is a ≤15–20% control group only. `>15%` API-vs-UI variance
  raises `parity_variance` flag. Never use Playwright as primary collection.

## 5. Tamper-evident provenance

- SHA-256 run manifest (`manifest.json`) + append-only JSONL audit (`audit.jsonl`).
- PII: `redact_pii=true` default; `hash_only_raw` stores `content_hash` + 500-char redacted preview.
- Verify: `python scripts/verify_manifest.py data/output/<run>`.
- This is the enterprise-legal counter to SOC2/SSO moats: "here's the hash, verify it yourself."

## 6. Cost engineering honesty

- ~24.5¢ per question × 6 engines. `max_calls_per_run:2500` fan-out guard.
- `$500/day` hard budget (`execution.cost_tracking.daily_budget_usd`), 80% alert threshold.
- Grok `search_cost` preserved AND billed. Local-first. Per-model/per-persona tracking.
- Multi-country geo matrix splits prompt budget **cost-flat** across `geo.countries`
  (not multiplied). Every row tagged `geo`.

## 7. Volatility honesty

- AIO shifts ~70% on repeat. `volatility.repeats:5` on money prompts
  (`comparison_analysis`, `pricing_procurement`).
- `volatility.py`: leader-flip rate + Wilson CIs; `unstable_share > 30%` = HIGH alert.
- Scheduler diffs latest vs previous only for Slack (SoMV drop >15%, competitor surge >15%,
  hallucination spike, CPR <50%). 90-day trends live in SQLite (`data/trends.db`,
  `analytics/trend_store.py`), not JSON files.
- Freshness windows enforced: ChatGPT/Perplexity ~30d, Claude ~quarter, AIO ~year.
  Stale money pages auto-raise Jira/Linear tickets (`scripts/refresh_tickets.py` output).

## 8. Retrieval + temporal + savings honesty (2026 enterprise layer)

- **RAG invalidation vectors**: the engine's hidden search queries are provider-reported
  truth about what was retrieved. A hidden query that never surfaces in citations is a
  reformulation failure (fix queries/domains, not copy). Families whose APIs expose no
  query surface report an explicit adapter gap — never averaged away.
- **Temporal drift**: paired snapshot rows isolate model re-index drift from site changes;
  single-snapshot runs say `no_snapshot_data` instead of guessing.
- **Savings**: agency math runs on MEASURED `cost_report.json` spend only; zero spend
  yields `no_spend`, never a claimed multiple.
- **Determinism**: funnel tie-breaks use canonical stage order so identical inputs yield
  identical recommendations, every run.
