# Looker Studio — Live Connector (not just a template)

Static template: `docs/looker_studio_template.json` (import once).
Live path (recommended for weekly reviews):

1. Publish the latest export: `GET /api/export?format=csv` → SoMV by_model flat (brand,model,mention_rate,primary_rate,omission_rate,n).
2. Full dump: `GET /api/export?format=jsonl` → pipeline summary + up to 5000 rows (retention-safe).
3. Trends: `GET /api/trends?days=90` (SQLite `data/trends.db`; JSON fallback cold-start).
4. In Looker Studio: Add source → URL Fetch / Community Connector → point at your hosted backend (`?api=` + token), schedule daily refresh after the 06:00 cron.
5. Blend GenAI (`gsc_genai_normalized.csv` via `scripts/gsc_genai_pull.py`) with SoMV CSV on page/domain for the impression-delta view (dashboard **Google Truth** mirrors this).

PDF export: every dashboard tab (incl. Geo + Exec Brief) prints via the PDF button / browser Print → Save as PDF (print CSS ships in `src/dashboard/index.html`).
