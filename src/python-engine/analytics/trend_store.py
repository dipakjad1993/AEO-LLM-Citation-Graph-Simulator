"""
90-day trend store — SQLite snapshots of SoMV / CPR / volatility per run.
Tables: run_snapshots(run_id, started_at, grounded_share, overall_cpr, unstable_share),
        somv_history(run_id, brand, model, mention_rate, primary_rate, omission_rate, n),
        alerts(run_id, type, payload).
Used by: main.py (upsert after pipeline), server /api/trends, dashboard 90-day charts,
         scheduler diff history. JSON files are latest-only; SQLite is history.
"""
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS run_snapshots(
  run_id TEXT PRIMARY KEY, started_at TEXT, grounded_share REAL,
  overall_cpr REAL, unstable_share REAL, snippet_blocked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS somv_history(
  run_id TEXT, brand TEXT, model TEXT, mention_rate REAL,
  primary_rate REAL, omission_rate REAL, n INTEGER,
  PRIMARY KEY(run_id, brand, model));
CREATE TABLE IF NOT EXISTS alerts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, type TEXT,
  payload TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS geo_splits(
  run_id TEXT, region TEXT, leader TEXT, leader_share REAL,
  PRIMARY KEY(run_id, region));
CREATE TABLE IF NOT EXISTS retention_policy(
  key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS citation_history(
  domain TEXT PRIMARY KEY, months_cited INTEGER DEFAULT 1,
  first_seen TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS sentiment_versions(
  run_id TEXT PRIMARY KEY, model TEXT, recorded_at TEXT);
"""


def db_path(root=None) -> Path:
    base = Path(root) if root else Path('data')
    base.mkdir(parents=True, exist_ok=True)
    return base / 'trends.db'


def upsert_run(results: Dict[str, Any], run_id: str, root=None) -> Path:
    db = db_path(root)
    con = sqlite3.connect(db)
    try:
        con.executescript(SCHEMA)
        somv = results.get('somv', {}) or {}
        grounded = (somv.get('grounded_only', {}) or {}).get('grounded_share')
        if grounded is None:
            grounded = (results.get('data_quality', {}) or {}).get('grounded_share')
        cpr = ((results.get('enterprise_insights', {}) or {}).get('multi_turn_cpr', {}) or {}).get('overall_cpr')
        vol = ((results.get('volatility', {}) or {}).get('summary', {}) or {}).get('unstable_share')
        site = results.get('site_audit', {}) or {}
        blocked = 1 if ((site.get('fail_gate', {}) or {}).get('snippet_blocked')) else 0
        con.execute(
            'INSERT OR REPLACE INTO run_snapshots(run_id, started_at, grounded_share, overall_cpr, unstable_share, snippet_blocked) VALUES(?,?,?,?,?,?)',
            (run_id, datetime.now(timezone.utc).isoformat(), grounded, cpr, vol, blocked))
        for model, mdata in (somv.get('by_model', {}) or {}).items():
            for brand, s in ((mdata.get('brand_stats', {}) or {}).items()):
                try:
                    con.execute(
                        'INSERT OR REPLACE INTO somv_history(run_id, brand, model, mention_rate, primary_rate, omission_rate, n) VALUES(?,?,?,?,?,?,?)',
                        (run_id, brand, model, s.get('mention_rate'), s.get('primary_recommendation_rate'), s.get('omission_rate'), s.get('n')))
                except Exception:
                    continue
        con.commit()
    finally:
        con.close()
    logger.info(f'Trend snapshot upserted: {run_id} -> {db}')
    return db


def upsert_citation_history(domains, run_id: str, root=None) -> None:
    """Track per-domain months-cited for Content Graveyard (Somantra-2026 replication).
    domains: iterable of domain strings cited in this run. Never fabricates history."""
    import re as _re
    from datetime import datetime as _dt, timezone as _tz
    db = db_path(root)
    con = sqlite3.connect(db)
    try:
        con.executescript(SCHEMA)
        now = _dt.now(_tz.utc).isoformat()
        seen = set()
        for d in (domains or []):
            d = str(d).strip().lower()
            if not d or d in seen:
                continue
            seen.add(d)
            row = con.execute("SELECT months_cited, first_seen FROM citation_history WHERE domain=?", (d,)).fetchone()
            if row is None:
                con.execute("INSERT INTO citation_history(domain, months_cited, first_seen, last_seen) VALUES(?,?,?,?)",
                            (d, 1, now, now))
            else:
                con.execute("UPDATE citation_history SET months_cited=months_cited+1, last_seen=? WHERE domain=?", (now, d))
        con.commit()
    finally:
        con.close()


def record_sentiment_version(run_id: str, model: str, root=None) -> None:
    """Version the sentiment model per run so VADER rows never compare to RoBERTa historically."""
    from datetime import datetime as _dt2, timezone as _tz2
    db = db_path(root)
    con = sqlite3.connect(db)
    try:
        con.executescript(SCHEMA)
        con.execute("INSERT OR REPLACE INTO sentiment_versions(run_id, model, recorded_at) VALUES(?,?,?)",
                    (run_id, model, _dt2.now(_tz2.utc).isoformat()))
        con.commit()
    finally:
        con.close()


def upsert_geo_split(run_id: str, region: str, leader: str, leader_share: float, root=None) -> None:
    """Persist weekly EU-vs-US leader split (buyers ask for regional proof)."""
    db = db_path(root)
    con = sqlite3.connect(db)
    try:
        con.executescript(SCHEMA)
        con.execute('INSERT OR REPLACE INTO geo_splits(run_id, region, leader, leader_share) VALUES(?,?,?,?)',
                    (run_id, region, leader, leader_share))
        con.commit()
    finally:
        con.close()


def get_retention_policy(root=None) -> Dict[str, Any]:
    """Data retention policy doc (buyers ask before annual contract)."""
    return {"raw_responses_days": 365, "trends_db": "indefinite (aggregates only)",
            "audit_log_days": 730, "pii": "redacted at persist (hash_only_raw optional)",
            "export": "GET /api/export?format=jsonl (full JSONL dump) + DELETE /api/admin/retention (admin)",
            "doc": "docs/retention.md"}


def record_alert(run_id: str, alert_type: str, payload: Dict[str, Any], root=None) -> None:
    db = db_path(root)
    con = sqlite3.connect(db)
    try:
        con.executescript(SCHEMA)
        con.execute('INSERT INTO alerts(run_id, type, payload, created_at) VALUES(?,?,?,?)',
                    (run_id, alert_type, json.dumps(payload, default=str), datetime.now(timezone.utc).isoformat()))
        con.commit()
    finally:
        con.close()
