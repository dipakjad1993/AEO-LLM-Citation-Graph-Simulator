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
