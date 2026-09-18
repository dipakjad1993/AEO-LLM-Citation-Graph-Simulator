# Providers & Model Registry (Sept 2026, live)

## Canonical registry

Source of truth: `config/models.json` (`version: 2026.09`). Defaults use current APIs:
OpenAI Responses `web_search`, Anthropic `web_search_20260209`, Gemini 2.5/3 grounding,
Grok live search, Perplexity Sonar, SERP for AIO/AI Mode/Copilot.

| Provider | Default model | Surface | Search | Adapter |
|---|---|---|---|---|
| OpenAI | `gpt-5.5` (Responses) | `chatgpt_api_grounded` | yes | `openai_responses_annotations` |
| OpenAI | `gpt-5-search-api` | `chatgpt_api_grounded` | yes | `openai_chat_annotations` |
| Anthropic | `claude-sonnet-4-20250514` | `claude_api_grounded` | yes | `anthropic_web_search_tool_result` |
| Google | `gemini-2.5-pro`, `gemini-3-flash` | `gemini_api_grounded` | yes | `gemini_grounding_chunks_resolve_redirect` |
| Perplexity | `sonar-pro` | `perplexity_api_grounded` | always | `perplexity_citations_flat` |
| xAI | `grok-4` | `grok_api_grounded` | yes | `openai_chat_annotations` (+`search_cost`) |
| Microsoft | `copilot-serp` (SERP API) | `copilot_serp_grounded` | yes | `serp_organic_results` |
| Google SERP | `google-ai-overviews`, `google-ai-mode` | `aio_serp_grounded` | yes | `serp_aio_citations` |
| DeepSeek | `deepseek-chat` | `deepseek_api_memory` | **no** (memory baseline) | `none_memory_only` |

Cost reference (Stork.AI Aug 2026, 925 runs): chatgpt $0.035, claude $0.101,
gemini $0.002, perplexity $0.02, grok $0.035, deepseek $0.002 per answer.
Avg citations/answer: chatgpt 7.92, claude 5.67, gemini-AIO 13.3, perplexity 21.87.
Index bias: ChatGPT=Bing/Wikipedia 16.3%; Claude=Brave/NYT-Atlantic-NPR, longest freshness;
Gemini=Google/Wikipedia 11.2%+YouTube 9.5%+Google-owned 22.8%; Perplexity=Sonar/Reddit 6.6%, 82% Google overlap.

## Late-2026 candidates (UNVERIFIED, never scheduled)

`late_2026_candidates` in `models.json` (gemini-3.1/3.5-flash, gemini-3-omni,
claude-sonnet-4-6, claude-opus-4-7, grok-4-1, grok-5, gpt-5.6, perplexity-agent)
are `scheduled:false + registry_status:unverified` with estimated costs.
The orchestrator refuses to query them until a human verifies the exact `model_id`
against provider docs and flips `scheduled:true`.

Nightly verifier: `node scripts/verify_model_registry.js` (also `scripts/verify_model_registry.py`
shim) hits provider doc endpoints / registry metadata and FAILS loudly on 404/rename.
Wire it to cron/GitHub Actions; do not enable candidates on rumor.

Deprecated IDs (gpt-4o-search-preview shutdown 2026-07-23, claude-3-opus, gemini-1.5-pro,
`web_search_preview` tool type) are retained for migration only; scheduler refuses them.

## Playwright — 15% parity control, NOT primary collection (ToS warning)

> ⚠️ **ToS / legal warning (read this):** automating ChatGPT / Claude / Gemini web UIs
> with Playwright may violate those services' Terms of Service, requires stealth +
> residential proxy + authenticated cookies, breaks weekly on UI changes, and costs ~16×
> API collection. **Default mode is `api_only`. `hybrid` adds a 15% (`playwright_sample_rate: 0.15`)
> opt-in control group for API/UI parity calibration only. `playwright_only` exists for
> debugging and must never be used for production tracking.**

- Config: `config/execution.json` → `execution.mode: api_only` (default),
  `modes: [hybrid, api_only, playwright_only]`, `playwright_sample_rate: 0.15`.
- `execution.playwright.warning` restates the opt-in + ToS risk.
- `playwright_targets` (chatgpt_web, claude_web, perplexity_web) are opt-in only;
  ChatGPT/Claude require cookie sessions in `data/sessions/`.
- Parity rule: API vs UI divergence >15% raises a variance flag; investigate, do not
  silently average.
- Marketing/docs must never list Playwright as a primary collection method.

## SERP surfaces (AIO / AI Mode / Copilot)

Collected via SERP API (`SERP_API_KEY + SERP_PROVIDER: serper|dataforseo|zenserp`),
not chat APIs. AIO + AI Mode share ~13.7% citations but are separate surfaces —
track fan-out queries independently. `location_code` is supported per row for
AI Mode geo (see `docs/enterprise.md` § Geo Matrix).

## Retrieval-geo control matrix (honest)

| Provider | Geo control | Notes |
|---|---|---|
| Anthropic | `user_location` (country) | Sent per call from session market |
| SERP (AIO/AI Mode/Copilot) | metro `location_code` | Metro table + `serp.location_map` override, country fallback logged per row |
| OpenAI / Perplexity / Grok / Gemini | none at API level | Market tag + Playwright per-market locale/timezone/proxy carry geo; `geo_applied` records this per row |
| Playwright UI | locale + timezone + residential proxy | Rotated per market group (`AEO_PROXY_<MARKET>` > `proxy_map` > default) |
