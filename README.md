# AEO & LLM Citation Graph Simulator

**Enterprise-Grade Generative Engine Optimization Intelligence Platform**

> The first open-source platform that reverse-engineers how Large Language Models (LLMs) perceive, rank, and recommend your brand -- and tells you exactly how to fix it. Replaces $15,000-$25,000/month AEO agency retainers.

---

![License](https://img.shields.io/badge/license-MIT-green)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)
![Python](https://img.shields.io/badge/Python-3.9%2B-yellow)
![Status](https://img.shields.io/badge/status-active-blue)

---

## Table of Contents

1. [What Is This Tool?](#1-what-is-this-tool)
2. [Why Does This Tool Exist?](#2-why-does-this-tool-exist)
3. [What Can It Do?](#3-what-can-it-do)
4. [Architecture Overview](#4-architecture-overview)
5. [Supported LLM Providers](#5-supported-llm-providers)
6. [Analysis Pipeline (10 Stages)](#6-analysis-pipeline-10-stages)
7. [Report Sections (10 Deep Dives)](#7-report-sections-10-deep-dives)
8. [Prerequisites](#8-prerequisites)
9. [Installation](#9-installation)
10. [Configuration](#10-configuration)
11. [Quick Start](#11-quick-start)
12. [Usage Guide](#12-usage-guide)
13. [Dashboard Features](#13-dashboard-features)
14. [PDF Export](#14-pdf-export)
15. [Configuration Reference](#15-configuration-reference)
16. [Project Structure](#16-project-structure)
17. [API Reference](#17-api-reference)
18. [Cost Analysis](#18-cost-analysis)
19. [Troubleshooting](#19-troubleshooting)
20. [Contributing](#20-contributing)
21. [Roadmap](#21-roadmap)
22. [License](#22-license)
23. [Acknowledgments](#23-acknowledgments)

---

## 1. What Is This Tool?

The **AEO & LLM Citation Graph Simulator** is a comprehensive, self-hosted intelligence platform designed for the emerging field of **Generative Engine Optimization (GEO)** -- the practice of optimizing your brand's visibility inside AI-generated answers.

### The Problem It Solves

When a potential customer asks ChatGPT, Claude, Gemini, or Perplexity for a product recommendation, the AI doesn't show a list of blue links like Google. Instead, it generates a single, authoritative answer. If your brand is **invisible** in that answer, you are losing deals you will never know about -- because there is no "page 2" in an AI response.

Traditional SEO tools track Google rankings. **No tool tracks AI rankings.** This tool does.

### What It Is

- A **local-first, privacy-respecting** platform (no data leaves your machine)
- A **10-stage analysis pipeline** that queries real LLMs and extracts structured intelligence
- A **real-time dashboard** with interactive charts, tables, and exportable PDF reports
- An **open-source alternative** to expensive AEO agency retainers ($15K-$25K/month)
- A **multi-model analyzer** that works across OpenAI, Anthropic, Google, Perplexity, and DeepSeek

### How It Works (High Level)

1. You provide prompts (or use built-in synthetic data)
2. The tool sends thousands of queries to 5 different LLM providers
3. It analyzes every response for brand mentions, sentiment, citations, and knowledge claims
4. It builds citation graphs showing which sources LLMs trust
5. It generates a comprehensive report with prioritized recommendations

![Landing Page](screenshots/landing-hero.png)

---

## 2. Why Does This Tool Exist?

### The Shift from Search to Generative AI

The way people find information is fundamentally changing:

| Era | Behavior | Brand Visibility Method |
|-----|----------|----------------------|
| **Google Era** (2000-2024) | "Search and browse" | SEO, backlinks, page rankings |
| **AI Era** (2024+) | "Ask and receive" | AEO, citation graphs, LLM trust signals |

### The Visibility Crisis

- **67%** of enterprise buyers now use AI assistants for vendor research
- **93%** of AI-generated answers contain citations to specific sources
- **78%** of brands are invisible in AI-generated product recommendations
- The average AI response cites **4.2 sources** -- if you are not one of them, you do not exist

### What This Tool Tells You

- "ChatGPT recommends Competitor_A over you 3:1 for [your product category]"
- "Claude cites Competitor_B's blog 12 times but never cites yours"
- "Gemini describes your brand using negative sentiment in 23% of responses"
- "Perplexity sources from Reddit threads that paint your brand poorly"
- "DeepSeek hallucinates features about your product that don't exist"

Without this data, you are flying blind in the most important marketing channel of the decade.

---

## 3. What Can It Do?

### Core Capabilities

#### Share of Model Voice (SoMV)
Your brand visibility score across every major LLM. Unlike Google rankings (which show position), SoMV measures the **proportion of AI-generated answers that mention your brand** versus competitors.

- Overall SoMV across all models
- Per-model breakdown (ChatGPT vs Claude vs Gemini vs Perplexity vs DeepSeek)
- Per-buyer-persona analysis
- Per-conversation-turn tracking
- Primary recommendation rate (how often you are the #1 pick)

#### Citation Graph Construction
Builds network graphs showing the **exact citation flows** between LLMs, brands, and source domains.

- Identifies which domains LLMs trust for your industry
- Maps competitor-dominant citation sources
- Finds "missing authority nodes" -- sources that cite competitors but not you
- PageRank analysis of citation authority
- Betweenness centrality to find most influential sources

#### Triple Extraction (Knowledge Graph)
Decomposes every LLM response into structured **(Subject, Predicate, Object)** claims.

- *"Your Brand"* -- *"is known for"* -- *"reliable enterprise software"*
- *"Your Brand"* -- *"lacks"* -- *"advanced AI features"*
- *"Competitor"* -- *"leads in"* -- *"customer satisfaction"*
- Positive vs negative vs neutral claim tracking
- Top predicates (what types of claims are being made)
- Brand-specific negative claim monitoring

#### Sentiment & Hallucination Detection
Analyzes sentiment distribution across all models and detects hallucination risks.

- Brand sentiment matrix (positive/negative/neutral rates per model)
- Turn-by-turn sentiment evolution
- Negative pattern clustering
- Hallucination signal detection (conflicting claims across models)
- Cross-model sentiment consistency analysis

#### RAG vs Base Weight Attribution
Determines whether your brand visibility problem stems from **web indexing (RAG)** or **pre-training data (base weights)**.

- Dual-query mode: same prompts with RAG enabled vs disabled
- If you perform better in RAG mode, your web presence is strong
- If you perform better in base mode, your pre-training authority needs work
- Crawler audit recommendations (GPTBot, ClaudeBot, PerplexityBot, etc.)

#### Semantic Embedding Analysis
Maps how LLMs **semantically cluster** your brand versus competitors.

- Brand vector profiles using sentence transformers
- Cross-model semantic similarity (how similarly different LLMs describe you)
- Semantic drift analysis (how different your description is from competitors)
- UMAP clustering visualization
- Response length and depth analysis per model

#### Competitive Gap Analysis
Identifies exactly where competitors lead and you lag.

- Primary recommendation rate gaps
- Mention rate differentials
- Omission rate analysis (how often LLMs ignore you entirely)
- Actionable remediation for each gap

#### Prioritized Recommendations
Generates a prioritized action list based on all analysis modules.

- HIGH/MEDIUM/LOW priority classification
- Category-tagged (SEO, Content, Schema, PR, etc.)
- Specific findings and actions for each recommendation
- Business impact estimation
- 4-phase implementation roadmap (Emergency, Foundation, Growth, Excellence)

#### Enterprise Intelligence (Advanced Graph Analytics)
The CMO-ready analytical layer that turns raw LLM response data into executive decisions. Computed exclusively from the real data captured by earlier stages -- no fabricated values.

- **API vs Web-UI Parity Calibration** -- measures response variance between API and browser channels for the same prompt/model; flags channels where variance exceeds 15%
- **Multi-Turn Citation Persistence Rate (CPR)** -- tracks whether citations survive across a 5-turn conversation or get truncated by context windows
- **Graph Authority Score** `G_auth = a*C_D(v) + b*C_B(v) + g*S_cos` -- degree/betweenness centrality blended with semantic cosine authority
- **Inverse Citation Mapping** -- domains competitors win citations from where you are absent, plus **LLM crawler robots.txt blockage detection** (GPTBot, ClaudeBot, PerplexityBot, Bytespider, Google-Extended)
- **Source-Level ROI Prioritization** -- ranks the exact sources that move your Citation Influence Weight the most
- **Semantic Gap Remediation Scripts** -- ready-to-publish JSON-LD + Markdown drafts generated from your missing/negative triples
- **SoMV Trendlines** -- share-of-voice by model family (OpenAI/Anthropic/Google/Perplexity/DeepSeek) and funnel stage

#### Data Quality & Provenance
The platform is engineered to be provably honest about what it analyzed.

- **Data Quality Coverage Report** -- every run computes a coverage score (records, citations, brand mentions, models) and surfaces warnings when the source data is thin or a file declares more prompts than it contains
- **Content Hashing & Audit Trail** -- SHA-256 fingerprints of every input/output; append-only run manifests so results can be traced to exact inputs and verified unmodified
- **Response Verification** -- live quality gates reject refusals and degenerately short text; cited URLs are resolved over HTTP with status, redirects, latency, and credibility recorded
- **Honest Empty States** -- modules that lack sufficient real data say so explicitly instead of rendering blank panels

![Dashboard Overview](screenshots/dashboard-overview.png)

---

## 4. Architecture Overview

The system uses a **dual-engine architecture**:

```
+----------------------------------------------------------+
|                    Web Dashboard (HTML/JS)                |
|                    Port 3000                              |
+----------------------------------------------------------+
         |                              |
         v                              v
+-------------------+     +-------------------------+
|  Node.js Server   |     |  Node.js Orchestrator   |
|  (server.js)      |     |  (index.js)             |
|  - Static files   |     |  - LLM API calls        |
|  - File uploads   |     |  - Playwright scraping   |
|  - API endpoints  |     |  - Rate limiting         |
|  - Process mgmt   |     |  - Cost tracking         |
+-------------------+     +-------------------------+
                                    |
                                    v
                          +-------------------------+
                          |  Python Engine          |
                          |  (main.py)              |
                          |  - Triple extraction    |
                          |  - Citation graphs      |
                          |  - SoMV analysis        |
                          |  - Embedding analysis   |
                          |  - Sentiment matrix     |
                          |  - Recommendations      |
                          |  - Dashboard generation |
                          +-------------------------+
                                    |
                                    v
                          +-------------------------+
                          |  Output                 |
                          |  - pipeline_summary.json |
                          |  - Dashboard HTML        |
                          |  - PDF Report            |
                          |  - JSON data exports     |
                          +-------------------------+
```

### Design Principles

1. **Privacy-First**: All data stays on your local machine. No cloud services required.
2. **Provider-Agnostic**: Works with OpenAI, Anthropic, Google, Perplexity, and DeepSeek.
3. **Modular Pipeline**: Each of the 10 stages can run independently.
4. **Cost-Aware**: Built-in cost tracking with budget limits and alerts.
5. **Real Data Only**: Every result is computed from real LLM API responses or real uploaded results. No synthetic or demo data is generated -- if the tool cannot make real API calls or find real uploaded data, it refuses to run.
6. **Provably Honest**: Every run emits a data-quality coverage report, content hashes, and an audit trail, so thin data is flagged transparently rather than silently producing empty output.

---

## 5. Supported LLM Providers

| Provider | Models | Web Search | Max Tokens | Cost (Input/Output per 1K) |
|----------|--------|------------|------------|---------------------------|
| **OpenAI** | GPT-4o, GPT-4o-mini | Yes | 128K | $0.005 / $0.015 |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus | No | 200K | $0.003 / $0.015 |
| **Google** | Gemini 1.5 Pro, Gemini 2.0 Flash | Yes | 2M | $0.00125 / $0.005 |
| **Perplexity** | Sonar Pro, Sonar Online | Yes (Always) | 200K | $0.003 / $0.015 |
| **DeepSeek** | DeepSeek-V2 | No | 128K | $0.00014 / $0.00028 |

### Web Scraping Targets (Playwright)

| Platform | Auth Required | Notes |
|----------|--------------|-------|
| ChatGPT Web | Cookie-based | For direct web access |
| Claude Web | Cookie-based | For direct web access |
| Perplexity Web | None | Public API preferred |

---

## 6. Analysis Pipeline (10 Stages)

The analysis runs as a 10-stage pipeline, each stage building on the previous. Progress is streamed live with real per-stage metrics (record counts, citation counts, elapsed time).

### Stage 1: Attribution Split (RAG vs Base)
- Sends each prompt twice: once with RAG enabled, once with base weights only
- Measures brand mention differences between modes
- Determines if visibility issues are web-indexing or pre-training related

### Stage 2: Triple Extraction
- Extracts structured (Subject, Predicate, Object) claims from every response
- Uses spaCy dependency parsing with negation detection
- Coreference resolution for pronoun handling
- Sentiment classification per triple

### Stage 3: Ground-Truth Claim Verification
- Verifies every extracted claim against an authoritative corpus built from your brand attributes (entity_maps.json), uploaded gold standards, and uploaded corpus documents
- Labels each claim **verified / partially_verified / unverified / contradicted** with an evidence passage, source, and confidence
- Per-model and per-brand veracity aggregation surfaces hallucinations and knowledge gaps instead of hiding them
- Produces `reports/claim_verification.json` for audit
- Honest behavior: with no ground-truth corpus available, every claim is reported UNVERIFIED (never fabricated)

### Stage 4: Citation Graph Construction
- Builds directed graphs: LLM -> Brand -> Source Domain
- Calculates PageRank, betweenness centrality, and eigenvector centrality
- Detects communities using Louvain algorithm
- Identifies missing authority nodes
- Brand co-occurrence graph built from `your_brand`/`competitor` entity types

### Stage 5: Share of Model Voice (SoMV)
- Computes mention rates, primary recommendation rates, and omission rates
- Breaks down by model, persona, and conversation turn
- Calculates leadership rankings

### Stage 6: Embedding & Semantic Analysis
- Generates sentence embeddings using all-mpnet-base-v2
- Computes brand vector profiles (intra-similarity)
- Cross-model semantic similarity comparison
- UMAP dimensionality reduction and HDBSCAN clustering

### Stage 7: Sentiment & Hallucination Matrix
- RoBERTa-based sentiment analysis (positive/negative/neutral)
- Brand sentiment matrix across all models
- Turn-by-turn sentiment evolution tracking
- Negative pattern clustering
- Hallucination signal detection (conflicting claims)

### Stage 8: Enterprise Intelligence & Advanced Graph Analytics
- API vs Web-UI parity calibration (flags channel variance > 15%)
- Multi-turn Citation Persistence Rate (CPR) across 5-turn conversations
- Graph Authority Score `G_auth` blending degree/betweenness centrality with cosine authority
- Inverse citation mapping + LLM crawler robots.txt blockage detection (GPTBot, ClaudeBot, PerplexityBot, Bytespider)
- Source-level ROI prioritization and semantic gap remediation script generation
- SoMV trendlines by model family and funnel stage
- Produces `enterprise_insights.json` for the CMO dashboard

### Stage 9: Dashboard Generation
- Plotly interactive charts
- HTML dashboard with dark/light themes, including a **Data Integrity & Provenance** panel
- JSON data exports for external analysis

### Stage 10: Recommendations & Strategy
- Prioritized action items (HIGH/MEDIUM/LOW)
- Veracity-based recommendations (contradicted claims, unverifiable claims, low-veracity models)
- 4-phase implementation roadmap
- Business impact estimates
- Competitive gap remediation

![Pipeline Stages](screenshots/pipeline-stages.png)

---

## 7. Report Sections (10 Deep Dives)

The dashboard generates 10 detailed analysis sections, an executive-facing **CMO Dashboard**, plus an executive summary:

| # | Section | Description |
|---|---------|-------------|
| C | **CMO Dashboard** | Executive single-page-of-truth: SoMV leaderboard, missing grounding sources with actions, hallucination alerts, remediation scripts, source ROI, SoMV trendlines, prioritized actions with revenue-at-risk estimates |
| 1 | **Executive Summary** | KPIs, success rate, model count, brand health snapshot, data-quality coverage banner |
| 2 | **Attribution: RAG vs Base** | Web indexing vs pre-training analysis with delta metrics |
| 3 | **Share of Model Voice** | Brand rankings, per-model SoMV, citation depth, omission analysis |
| 4 | **Triple Extraction** | Knowledge graph claims, sentiment distribution, negative claims |
| 5 | **Citation Graphs** | Network metrics, PageRank, centrality, missing authority nodes |
| 6 | **Embeddings & Semantics** | Brand vectors, cross-model similarity, semantic drift, clusters |
| 7 | **Sentiment & Hallucination** | Sentiment matrix, turn evolution, negative pattern clusters |
| 8 | **Detected Biases** | Bias patterns, hallucination signals, severity ratings |
| 9 | **Strategic Recommendations** | Prioritized actions, business impact, implementation roadmap |
| 10 | **Enterprise Intelligence** | Parity calibration, citation persistence, graph authority, inverse citation mapping, crawler block detection, source ROI, remediation scripts, trendlines |
| S | **Strategic Summary** | Consolidated health score, 4-phase action plan |

![Report Sections](screenshots/report-sections.png)

#### CMO Intelligence Dashboard
The executive single-page-of-truth, computed live from this run's real analysis modules — SoMV leaderboard, data coverage, prioritized actions, and enterprise intelligence all in one view.

![CMO Intelligence Dashboard](screenshots/cmo-dashboard.png)

---

## 8. Prerequisites

### Required

- **Node.js 18+** (for the web dashboard and orchestrator)
- **Python 3.9+** (for the analysis engine)
- **npm** (Node.js package manager)
- **pip** (Python package manager)

### Optional (for real LLM queries)

- **OpenAI API Key** (for GPT-4o, GPT-4o-mini)
- **Anthropic API Key** (for Claude 3.5 Sonnet, Claude 3 Opus)
- **Google AI API Key** (for Gemini 1.5 Pro, Gemini 2.0 Flash)
- **Perplexity API Key** (for Sonar Pro, Sonar Online)
- **DeepSeek API Key** (for DeepSeek-V2)

### Optional (for web scraping)

- **Playwright browsers** (Chromium, Firefox, WebKit)
- **Residential proxy** (for rate-limited scraping)

### Minimum System Requirements

- **OS**: Windows 10+, macOS 12+, Ubuntu 20.04+
- **RAM**: 8GB minimum, 16GB recommended (for embedding models)
- **Disk**: 2GB free space (for models, embeddings, and output)
- **Network**: Internet connection (for API calls and model downloads)

---

## 9. Installation

### Automatic Setup (Recommended)

**Windows (PowerShell):**
```powershell
git clone https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator.git
cd AEO-LLM-Citation-Graph-Simulator
.\setup.ps1
```

**macOS / Linux:**
```bash
git clone https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator.git
cd AEO-LLM-Citation-Graph-Simulator
chmod +x setup.ps1
```

### Manual Setup

**Step 1: Clone the repository**
```bash
git clone https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator.git
cd AEO-LLM-Citation-Graph-Simulator
```

**Step 2: Install Node.js dependencies**
```bash
npm install
```

**Step 3: Install Playwright browsers**
```bash
npx playwright install chromium --with-deps
```

**Step 4: Install Python dependencies**
```bash
pip install -r requirements.txt
```

**Step 5: Download spaCy model**
```bash
python -m spacy download en_core_web_sm
```

**Step 6: Configure environment**
```bash
cp .env.example .env
# Edit .env with your API keys

# Optional: interactive setup wizard (validates keys with live API calls,
# generates config/entity_maps.json from your brand + competitors)
npm run setup
```

### Docker Installation (Coming Soon)

```bash
docker-compose up -d
```

---

## 10. Configuration

### Environment Variables (.env)

Copy `.env.example` to `.env` and configure:

```env
# === API Keys (at least one required for real analysis) ===
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
GOOGLE_AI_API_KEY=your-google-ai-key
PERPLEXITY_API_KEY=pplx-your-perplexity-key
DEEPSEEK_API_KEY=your-deepseek-key

# === Execution Parameters ===
MAX_CONCURRENT_REQUESTS=10
REQUEST_TIMEOUT_MS=120000
RETRY_ATTEMPTS=3
RETRY_DELAY_MS=2000

# === Model Parameters ===
TEMPERATURE=0.15
TOP_P=0.9
MAX_TOKENS=4096

# === RAG Toggle (for dual-query attribution) ===
RAG_ENABLED=true
RAG_DISABLED=false

# === Proxy (for geo-localized scraping) ===
PROXY_SERVER=
PROXY_USERNAME=
PROXY_PASSWORD=
RESIDENTIAL_PROXY_ROTATION=false

# === Cost Control ===
DAILY_BUDGET_USD=500.00
COST_ALERT_THRESHOLD=0.8

# === Output Paths ===
OUTPUT_DIR=./data/output
GRAPHS_DIR=./data/output/graphs
REPORTS_DIR=./data/output/reports
EMBEDDINGS_DIR=./data/output/embeddings
```

### Configuration Files (config/)

| File | Purpose |
|------|---------|
| `config/models.json` | LLM model definitions, API endpoints, pricing |
| `config/analytics.json` | NLP, graph, sentiment, and embedding settings |
| `config/personas.json` | Buyer persona definitions for targeted queries |
| `config/entity_maps.json` | Brand entity mappings and aliases |
| `config/execution.json` | Rate limiting, retry, and timeout settings |
| `config/schema.json` | Data validation schemas |
| `config/validator.js` | Fail-fast validation of config + environment before API calls |

---

## 11. Quick Start

### Option A: Real Analysis (API Keys Required)

1. Copy `.env.example` to `.env` and add at least one API key
2. Run the setup wizard (validates keys with real API calls and generates `entity_maps.json`):
   ```bash
   npm run setup
   ```
3. Configure your brand and competitors in the dashboard's **Brand & Competitive Set** form (or directly in `config/entity_maps.json`)
4. Start the server:
   ```bash
   npm start
   ```
5. Open http://localhost:3000
6. Upload your prompt files (or paste JSON) and configure enterprise inputs (RAG, temporal, geo)
7. Click **"Start Full Analysis"**
8. Monitor progress in the pipeline output log -- each stage streams real metrics
9. Explore results in the **CMO Dashboard** and export PDF

### Option B: Command Line

```bash
# Run the orchestrator (real API calls across all configured models)
node src/node-orchestrator/index.js --mode api_only --prompts 100

# Run analysis on the latest orchestrator run
python src/python-engine/main.py

# Run analysis on a specific run
python src/python-engine/main.py --run-dir ./data/output/run_XXXXXX
```

---

## 12. Usage Guide

### Step-by-Step Walkthrough

#### 1. Start the Server
```bash
npm start
```
The server starts on http://localhost:3000

#### 2. Access the Dashboard
Open your browser to http://localhost:3000

#### 3. Configure & Upload Data

**Configure your enterprise context** (every field has a "How to fill this" hint toggle):
- **Brand & Competitive Set** -- your primary brand, website, category, and competitor URLs
- **Dynamic Search-Informed Context** -- RAG invalidation vectors (TTL, semantic-delta, tombstone, purge signals)
- **Temporal Grounding & Model Freshness** -- baseline vs current model snapshots, content freshness timestamp, paired comparison mode
- **Geographic Proxy & Localization** -- target markets (US-NY, UK-LND, APAC-SYD), residential proxy settings, rotation intervals
- **LLM Providers & Execution** -- prompt count, concurrency, temperature, RAG toggle

**Upload your own data:**
- **Prompts** (JSON/CSV): Conversation trees, persona vectors, negative prompt matrices
- **Entity Maps** (JSON): Brand names, aliases, competitor mappings
- **Corpus** (JSON/TXT/MD): Your brand content for embedding analysis
- **Gold Standards** (JSON): Ground-truth corpus for claim verification
- **System Config** (JSON/YAML): Custom configuration overrides
- **Results** (JSON): Previous analysis results for re-analysis (both full `all_results.json` and summary formats are supported)

Your brand/competitor form input is automatically merged into `entity_maps.json` before analysis.

#### 4. Run the Analysis
- Click **"Start Full Analysis"** to run the full 10-stage pipeline
- Monitor progress in real-time via the pipeline output log -- each stage streams real metrics (records, citations found, elapsed time)
- A **Data Quality banner** appears with the run's coverage score if the source data is thin

#### 5. Explore Results

The dashboard presents 11+ analysis sections:

- **CMO Dashboard**: Executive single page of truth
- **Executive Summary**: Key metrics at a glance
- **Attribution**: RAG vs base weight analysis
- **SoMV**: Brand visibility rankings
- **Triples**: Knowledge graph claims
- **Citation Graphs**: Source authority mapping
- **Embeddings**: Semantic positioning
- **Sentiment**: Brand perception analysis
- **Biases**: Detected patterns and risks
- **Recommendations**: Prioritized action items
- **Enterprise Intelligence**: Advanced graph analytics and remediation scripts

#### 6. Export PDF
- Click **"Download PDF Report"** in the hero section or navigation bar
- The PDF includes all sections with charts captured as images
- Share with leadership, agencies, or team members

![Usage Flow](screenshots/usage-flow.png)

---

## 13. Dashboard Features

### Real-Time Navigation
- Sticky navigation bar with section jumping
- Reading progress indicator
- Back-to-top button
- Section collapse/expand

### CMO Dashboard (Executive View)
- **SoMV Leaderboard** -- brand rankings across all models with leadership indicators
- **Top Grounding Sources Missing** -- sources your competitors are cited from but you are absent on, each with a specific action
- **Hallucination & Attribute-Deficit Alerts** -- flagged claims and knowledge gaps
- **Remediation Scripts** -- ready-to-publish JSON-LD and Markdown drafts
- **Source-Level ROI Prioritization** -- where to invest to move citation influence
- **SoMV Trendlines** -- by model family and funnel stage
- **Prioritized Actions** -- with revenue-at-risk estimates

### Data Quality & Transparency
- **Data Quality banner** in the hero showing coverage score and warnings
- **Honest empty states** -- sections clearly explain why a module has no data instead of rendering blank panels
- **Field help toggles** -- every input on the first page has a "How to fill this" hint note

### Interactive Charts (Plotly)
- Share of Voice by Model (bar chart)
- Sentiment Distribution (stacked bar chart)
- Chart capture for PDF export

### Data Tables
- Sortable brand performance tables
- Model-by-model SoMV breakdown
- Citation depth analysis
- Top cited domains with progress bars

### KPI Cards
- Auto-animated counters
- Color-coded health indicators
- Responsive grid layout

### Visual Elements
- Gradient section headers
- Priority-colored recommendation cards
- Severity-tagged bias indicators
- Progress bars with shimmer animations

---

## 14. PDF Export

The PDF export uses html2pdf.js to capture the dashboard and format it for A4 pages:

### Features
- Full-page content capture
- Chart images embedded at high resolution (2x scale)
- Section-appropriate page breaks
- Print-optimized styling

### How to Export
1. Click **"Download PDF Report"** button
2. Wait for the loading overlay to complete
3. The PDF auto-downloads with timestamped filename

### PDF Sections
The exported PDF includes:
- Hero section with report title
- All 9 analysis sections
- Charts captured as images
- Tables and KPI cards
- Recommendations and strategic summary

![PDF Export](screenshots/pdf-export.png)

---

## 15. Configuration Reference

### Model Configuration (config/models.json)

Each model entry includes:
- `model_id`: API model identifier
- `display_name`: Human-readable name
- `provider`: Provider identifier
- `supports_web_search`: Whether the model can browse
- `max_tokens`: Maximum context window
- `cost_per_1k_input`: Input token cost (USD)
- `cost_per_1k_output`: Output token cost (USD)
- `temperature_range`: Allowed temperature values
- `api_endpoint`: Provider API URL

### Analytics Configuration (config/analytics.json)

- **NLP settings**: spaCy model, sentence transformer, chunk sizes
- **Graph settings**: Directed/undirected, centrality algorithms, community detection
- **Sentiment settings**: Model name, thresholds for positive/negative/neutral
- **Triple extraction**: Method, confidence threshold, negation detection
- **Embedding settings**: Model, dimension, batch size, similarity threshold
- **Anomaly detection**: Algorithm, cluster size, contamination rate

### Execution Configuration (config/execution.json)

- Rate limiting parameters (requests per second)
- Retry logic (attempts, delays)
- Timeout settings
- Concurrent request limits

---

## 16. Project Structure

```
AEO-LLM-Citation-Graph-Simulator/
|
|-- server.js                          # Node.js HTTP server (port 3000)
|-- setup.js                           # Interactive setup wizard (validates API keys live)
|-- package.json                       # Node.js dependencies
|-- requirements.txt                   # Python dependencies
|-- setup.ps1                          # Quick setup script
|-- .env.example                       # Environment variable template
|-- .gitignore                         # Git ignore rules
|
|-- config/                            # Configuration files
|   |-- analytics.json                 # NLP, graph, sentiment settings
|   |-- entity_maps.json               # Brand entity definitions
|   |-- execution.json                 # Rate limiting and retry config
|   |-- models.json                    # LLM model definitions
|   |-- personas.json                  # Buyer persona vectors
|   |-- schema.json                    # Data validation schemas
|   |-- validator.js                   # Fails-fast config + environment validation
|
|-- data/
|   |-- system_inputs.json             # Saved enterprise inputs (brand, RAG, geo, temporal)
|   |-- prompts/                       # Input prompt templates
|   |-- output/                        # Analysis output (gitignored)
|   |-- uploads/                       # User uploads (gitignored)
|
|-- src/
|   |-- dashboard/                     # Web dashboard
|   |   |-- index.html                 # Main dashboard page
|   |   |-- sections.js                # Report section renderers
|   |
|   |-- node-orchestrator/             # Node.js orchestration engine
|   |   |-- index.js                   # Main orchestrator entry
|   |   |-- providers/                 # LLM API providers
|   |   |   |-- openai.js             # OpenAI (GPT-4o)
|   |   |   |-- anthropic.js          # Anthropic (Claude)
|   |   |   |-- google.js             # Google (Gemini)
|   |   |   |-- perplexity.js         # Perplexity (Sonar)
|   |   |   |-- deepseek.js           # DeepSeek
|   |   |-- scrapers/
|   |   |   |-- playwrightScraper.js  # Web scraping with Playwright
|   |   |-- utils/
|   |       |-- costTracker.js         # API cost tracking
|   |       |-- promptGenerator.js     # Prompt generation utilities
|   |       |-- rateLimiter.js         # Rate limiting
|   |       |-- responseExtractor.js   # Response parsing
|   |       |-- testRunner.js          # Test runner
|   |       |-- provenance.js          # SHA-256 hashing, run manifests, audit trail
|   |       |-- responseVerifier.js    # Quality gates + live citation verification
|   |       |-- unitTests.js           # Unit test suite
|   |
|   |-- python-engine/                 # Python analysis engine
|       |-- main.py                    # Main analysis entry (10-stage pipeline)
|       |-- brand_utils.py             # Shared flex-separator brand pattern matching
|       |-- pipeline/
|       |   |-- attribution_split.py   # RAG vs base attribution
|       |   |-- triple_extractor.py    # Knowledge triple extraction
|       |   |-- verification.py        # Ground-truth claim verification
|       |-- analytics/
|       |   |-- share_of_voice.py      # SoMV computation
|       |   |-- citation_graph.py      # Citation graph construction
|       |   |-- embedding_analyzer.py  # Semantic embedding analysis
|       |   |-- sentiment_matrix.py    # Sentiment analysis
|       |   |-- enterprise_insights.py # Enterprise intelligence & advanced graph analytics
|       |-- dashboard/
|       |   |-- generate.py            # HTML dashboard generator
|       |-- models/                    # Data models
|       |-- tests/                     # Unit tests
|       |   |-- test_pipeline.py
|       |   |-- test_verification.py
|
|-- lib/                               # Third-party libraries
|   |-- vis-9.1.2/                    # vis.js network graphs
|   |-- tom-select/                    # Tom Select dropdowns
|   |-- bindings/                      # JS bindings
|
|-- logs/                              # Application logs (gitignored)
```

---

## 17. API Reference

### Server Endpoints (server.js)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serve dashboard HTML |
| `POST` | `/api/upload/{section}` | Upload files to a section |
| `GET` | `/api/uploads` | List all uploaded files |
| `DELETE` | `/api/upload/{section}/{filename}` | Delete an uploaded file |
| `GET` | `/api/config` | Get saved enterprise system inputs |
| `POST` | `/api/config` | Save enterprise system inputs (brand, RAG, temporal, geo, execution) |
| `POST` | `/api/analyze` | Start analysis pipeline |
| `GET` | `/api/status?id={procId}` | Get analysis status |
| `GET` | `/api/results` | Get latest results |
| `GET` | `/api/runs` | List session runs |

### Upload Sections

- `prompts` - Core prompt inputs
- `entities` - Brand entity maps
- `corpus` - Content corpus
- `gold_standards` - Gold standard data
- `system_config` - Configuration overrides
- `results` - Previous analysis results

### Response Format

All API responses are JSON with standard structure:
```json
{
  "success": true,
  "data": { ... }
}
```

Or on error:
```json
{
  "error": "Error message"
}
```

---

## 18. Cost Analysis

### Estimated Costs Per 500 Prompts Across 5 Models

| Provider | Model | Input Tokens | Output Tokens | Est. Cost |
|----------|-------|-------------|---------------|-----------|
| OpenAI | GPT-4o | 500K | 250K | $6.25 |
| OpenAI | GPT-4o-mini | 500K | 250K | $0.23 |
| Anthropic | Claude 3.5 Sonnet | 500K | 250K | $5.25 |
| Google | Gemini 1.5 Pro | 500K | 250K | $1.88 |
| Google | Gemini 2.0 Flash | 500K | 250K | $0.11 |
| Perplexity | Sonar Pro | 500K | 250K | $5.25 |
| Perplexity | Sonar Online | 500K | 250K | $0.75 |
| DeepSeek | DeepSeek-V2 | 500K | 250K | $0.14 |

### Budget Control

- Set `DAILY_BUDGET_USD` in `.env` to cap spending
- `COST_ALERT_THRESHOLD` (0.8 = 80%) triggers warnings
- Cost tracker logs all API calls with per-request breakdown
- Dashboard shows cost-per-model and cost-per-provider summaries

### Cost Optimization Tips

1. Start with **GPT-4o-mini** and **Gemini 2.0 Flash** for initial testing
2. Use **DeepSeek** for budget-friendly bulk analysis
3. Enable `RAG_ENABLED=false` to skip RAG queries during development
4. Reduce `MAX_TOKENS` for shorter response capture
5. Use fewer prompts for quick iterations, scale up for final analysis

---

## 19. Troubleshooting

### Common Issues

#### "Server not responding" / "localhost refused to connect"
```bash
# Check if port 3000 is in use
netstat -ano | findstr :3000

# Kill existing process if needed
taskkill /PID <PID> /F

# Restart server
npm start
```

#### "No data to analyze"
- Ensure you've run the orchestrator (`node src/node-orchestrator/index.js`) or uploaded real results JSON
- Check that `data/output/` contains analysis directories
- Verify the `all_results.json` file exists

#### "Python not found"
- Ensure Python 3.9+ is installed and in PATH
- Run `python --version` to verify
- On Windows, try `py` instead of `python`

#### "spaCy model not found"
```bash
python -m spacy download en_core_web_sm
```

#### "Playwright browsers not installed"
```bash
npx playwright install chromium --with-deps
```

#### "API key errors"
- Verify `.env` file exists (copy from `.env.example`)
- Check API key format (OpenAI keys start with `sk-`)
- Ensure API keys have sufficient credits
- Check rate limits for your API tier

#### PDF generation fails
- Ensure the dashboard has results loaded
- Check browser console for JavaScript errors
- Try refreshing the page before export
- Large reports may take longer to generate

### Logs

Application logs are stored in the `logs/` directory:
- `server.log` - Server request logs
- Analysis logs are in the output run directories

---

## 20. Contributing

Contributions are welcome. Please follow these guidelines:

### Development Setup

1. Fork the repository
2. Clone your fork
3. Create a feature branch: `git checkout -b feature/your-feature`
4. Make your changes
5. Run tests: `npm test`
6. Commit with clear messages
7. Push to your fork
8. Create a Pull Request

### Code Style

- **JavaScript**: ES modules, async/await, clear variable naming
- **Python**: Type hints, docstrings, PEP 8 compliance
- **HTML/CSS**: Semantic markup, BEM-like naming, responsive design

### Testing

```bash
# Run all Node.js + Python tests
npm test

# Run Node.js unit tests only
npm run test:unit

# Validate config + environment (fails fast before any API call)
npm run validate

# Run Python pipeline tests
npm run validate:python
```

### Areas for Contribution

- Additional LLM provider support (Cohere, Meta Llama, Mistral)
- Web scraping improvements
- Visualization enhancements
- Mobile-responsive dashboard
- Docker containerization
- Internationalization (i18n)
- Performance optimization
- Additional chart types
- Export formats (CSV, Excel, PowerPoint)

---

## 21. Roadmap

### v2.0 (Current)
- [x] Enterprise Intelligence module (parity calibration, CPR, graph authority, inverse citation mapping, crawler block detection, source ROI, remediation scripts, trendlines)
- [x] CMO Dashboard executive output page
- [x] Data-quality coverage gate with honest empty states
- [x] Response verification and live citation checking
- [x] Content hashing, run manifests, and audit trail (provenance)
- [x] Config validator with fail-fast validation
- [x] Interactive setup wizard with live API key validation
- [x] Enterprise system inputs form (brand, RAG invalidation, temporal grounding, geo localization)
- [x] Summary-format results ingestion for re-analysis

### v2.1 (Planned)
- [ ] Docker containerization
- [ ] Additional LLM providers (Cohere, Mistral, Meta)
- [ ] Batch upload support
- [ ] CSV/Excel export
- [ ] Mobile-responsive dashboard

### v2.2 (Planned)
- [ ] Real-time monitoring dashboard
- [ ] Scheduled analysis runs
- [ ] Email/Slack notifications
- [ ] Historical trend tracking
- [ ] Multi-language prompt support

### v3.0 (Future)
- [ ] Web UI for prompt editor
- [ ] Collaborative analysis workspaces
- [ ] Plugin system for custom analytics
- [ ] API access for external integrations
- [ ] Enterprise SSO support

---

## 22. License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2024 AEO Citation Graph Simulator

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 23. Acknowledgments

### Technologies Used

- **Node.js** - Runtime environment
- **Python** - Analysis engine
- **Playwright** - Browser automation
- **spaCy** - Natural language processing
- **sentence-transformers** - Semantic embeddings
- **NetworkX** - Graph analysis
- **Plotly** - Interactive visualizations
- **PyTorch** - Deep learning backend
- **html2pdf.js** - PDF generation

### Data Sources

- OpenAI API documentation
- Anthropic API documentation
- Google AI Studio documentation
- Perplexity API documentation
- DeepSeek API documentation

### Research

- Generative Engine Optimization (GEO) concepts
- Large Language Model citation analysis
- Knowledge graph construction
- Sentiment analysis methodologies
- Network graph centrality algorithms

---

## Contact

- **GitHub**: [dipakjad1993](https://github.com/dipakjad1993)
- **Repository**: [AEO-LLM-Citation-Graph-Simulator](https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator)

---

*Built to replace $15,000-$25,000/month AEO agency retainers with open-source intelligence.*
