# Data Retention Policy (procurement-ready)

Buyers ask this before an annual contract. Defaults are conservative and deletable on request.

| Data | Retention | Export | Delete |
|---|---|---|---|
| Raw LLM responses (`data/output/run_*`) | 365 days | `GET /api/export?format=jsonl` | `DELETE /api/admin/retention` (admin, OIDC) or `rm -rf data/output/run_*` |
| Trends aggregates (`data/trends.db`: run_snapshots, somv_history, alerts, geo_splits) | Indefinite (aggregates only, no PII) | `GET /api/trends?days=365` | SQL `DELETE FROM somv_history WHERE run_id=...` |
| Audit chain (`logs/audit.jsonl` + SQLite) | 730 days, hash-chained | `GET /api/audit?limit=1000` | Never silent — deletions are themselves audit events |
| PII | Redacted at persist (`redact_pii=true` default; `hash_only_raw` stores content_hash + 500-char redacted preview) | n/a | Immediate on request |

Verify provenance any time: `python scripts/verify_manifest.py data/output/<run>` (SHA-256 manifest.json + append-only JSONL).
White-label + unlimited seats: self-hosted instances carry no per-seat metering; SSO/RBAC matrix in `config/security.json`.
