# AEO & LLM Citation Tracker (Python / Node.js)

An open-source analysis tool designed to track, measure, and analyze brand visibility, entity mentions, and citation sources across search-augmented AI engines (ChatGPT, Claude, Gemini, Perplexity).

---

## Overview

As users increasingly rely on AI search engines for vendor and product recommendations, monitoring brand presence across non-traditional search channels has become essential. 

This tool provides a local pipeline to query LLM APIs, extract structured entity mentions, build citation network graphs, and track how different models cite source web domains.

---

## Key Features

* **Share of Model Voice (SoMV) Tracking:** Calculates brand mention frequency across OpenAI, Anthropic, Google, and Perplexity API responses.
* **Citation Domain Analysis:** Identifies which third-party websites and domains are most frequently cited by search-augmented LLMs for specific query sets.
* **Knowledge Claim Extraction:** Uses spaCy NLP to parse basic subject-predicate-object claims from LLM responses to monitor brand attributes.
* **RAG vs Base Comparison:** Evaluates mention rate differences when web search retrieval (RAG) is enabled versus base model outputs.
* **Local Web Dashboard:** Renders interactive Plotly graphs, sentiment breakdowns, and exportable audit reports via a local Node.js interface.

---

## System Architecture

The project operates on a lightweight dual-engine setup:

1. **Node.js Orchestrator (`src/node-orchestrator/`):** Manages API connections, handles rate limiting, and collects raw response payloads from configured LLM endpoints.
2. **Python Analysis Engine (`src/python-engine/`):** Processes text outputs, runs spaCy NLP parsing, constructs citation graphs using NetworkX, and outputs structured JSON datasets.
3. **Web Interface (`server.js`):** Displays summary metrics and network visualization graphs locally on `port 3000`.

---

## Requirements

* **Node.js:** v18+
* **Python:** 3.9+
* **API Keys:** At least one active key (OpenAI, Anthropic, Google Gemini, or Perplexity)

---

## Quick Start

### 1. Installation

```bash
# Clone repository
git clone https://github.com/dipakjad1993/AEO-LLM-Citation-Graph-Simulator.git
cd AEO-LLM-Citation-Graph-Simulator

# Install Node dependencies
npm install

# Install Python requirements
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

### 2. Configuration

Copy `.env.example` to `.env` and insert your API keys:

```bash
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

Configure your target brand and competitors in `config/entity_maps.json`.

### 3. Run

```bash
# Start local dashboard server
npm start
```

Open `http://localhost:3000` to run prompt batches and view analysis reports.

---

## Project Structure

```
├── config/              # Model settings & brand entity definitions
├── src/
│   ├── node-orchestrator/ # API query runners & rate limiters
│   └── python-engine/    # NLP processing, graph building & metrics
├── server.js            # Local web server
└── package.json
```

---

## License

MIT License. Open for community feedback and contributions.
